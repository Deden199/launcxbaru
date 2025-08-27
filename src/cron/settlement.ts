import cron, { ScheduledTask } from 'node-cron'
import axios from 'axios'
import https from 'https'
import os from 'os'
import pLimit from 'p-limit'
import { prisma } from '../core/prisma'
import { config } from '../config'
import crypto from 'crypto'
import logger from '../logger'
import { sendTelegramMessage } from '../core/telegram.axios'
import { tryAdvisoryLock, releaseAdvisoryLock } from '../util/dbLock'

// ————————— CONFIG —————————
const BATCH_SIZE = 1500                          // jumlah order PAID diproses per batch
const HTTP_CONCURRENCY = Math.max(10, os.cpus().length * 2)
const DB_CONCURRENCY   = Number(process.env.DB_CONCURRENCY ?? os.cpus().length) // parallel DB transactions
const WORKER_CONCURRENCY = Number(process.env.SETTLEMENT_WORKERS ?? 1)
const DB_TX_TIMEOUT_MS = Number(process.env.SETTLEMENT_DB_TX_TIMEOUT_MS ?? 15_000)
const PARTNER_TX_CHUNK_SIZE = 50
const SETTLEMENT_LOCK_KEY = 1_234_567_890

type Cursor = { createdAt: Date; id: string } | null

// HTTPS agent dengan keep-alive
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
  keepAlive: true
});

// retry helper untuk deadlock/write-conflict
async function retryTx(fn: () => Promise<any>, attempts = 5, baseDelayMs = 100) {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = (err.message ?? '').toLowerCase();
      const code = String(err.code || '').toUpperCase();
      const retryableMsgs = ['write conflict', 'transaction already closed', 'transaction timeout', 'deadlock detected'];
      const retryableCodes = ['40P01', '40001', '55P03'];
      const reason = retryableMsgs.find(r => msg.includes(r)) || (retryableCodes.includes(code) ? code : undefined);
      if (i < attempts - 1 && reason) {
        const delay = baseDelayMs * 2 ** i;
        logger.warn(
          `[SettlementCron] retryTx attempt ${i + 1} failed (${reason}), retrying in ${delay}ms…`,
          err.message
        );
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// signature helper
function generateSignature(path: string, secretKey: string): string {
  return crypto
    .createHash('md5')
    .update(path + secretKey, 'utf8')
    .digest('hex');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

type SettlementResult = { netAmt: number; rrn: string; st: string; tmt?: Date; fee?: number };

type BatchResult = {
  hasMore: boolean;
  settledCount: number;
  netAmount: number;
  lastCursor: Cursor;
};

// core worker: proses satu batch; return object with stats
async function processBatch(cursor: Cursor): Promise<BatchResult> {
  // cursor-based pagination
  const where: any = {
    status: 'PAID',
    partnerClientId: { not: null },

    // hanya sampai cut‑off
    ...(cutoffTime && { createdAt: { lte: cutoffTime } }),

    ...(cursor
      ? {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } }
          ]
        }
      : {})
  };

  const fetchedOrders = await prisma.order.findMany({
    where,
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' }
    ],
    take: BATCH_SIZE,
    select: {
      id: true,
      partnerClientId: true,
      pendingAmount: true,
      channel: true,
      createdAt: true,
      subMerchant: { select: { credentials: true } }
    }
  });

  if (!fetchedOrders.length) {
    return { hasMore: false, settledCount: 0, netAmount: 0, lastCursor: cursor };
  }

  const last = fetchedOrders[fetchedOrders.length - 1];
  const lastCursor: Cursor = { createdAt: last.createdAt, id: last.id };

  // Claim orders by marking them as PROCESSING so other workers skip them
  const claimLimit = pLimit(DB_CONCURRENCY);
  type PendingOrder = (typeof fetchedOrders)[number];
  const claimedOrders: PendingOrder[] = [];
  await Promise.all(
    fetchedOrders.map(o =>
      claimLimit(async () => {
        const upd = await prisma.order.updateMany({
          where: { id: o.id, status: 'PAID' },
          data: { status: 'PROCESSING', updatedAt: new Date() }
        });
        if (upd.count > 0) {
          claimedOrders.push(o);
        }
      })
    )
  );

  const pendingOrders = claimedOrders;

  if (!pendingOrders.length) {
    return { hasMore: fetchedOrders.length === BATCH_SIZE, settledCount: 0, netAmount: 0, lastCursor };
  }

  logger.info(`[SettlementCron] processing ${pendingOrders.length} orders`);

  const unsettledIds = new Set(pendingOrders.map(o => o.id));
  const httpLimit = pLimit(HTTP_CONCURRENCY);
  const groups = new Map<string, { order: PendingOrder; settlement: SettlementResult }[]>();

  await Promise.all(
    pendingOrders.map(o =>
      httpLimit(async () => {
        try {
          const creds =
            o.subMerchant?.credentials as { merchantId: string; secretKey: string } | undefined;
          if (!creds) {
            return;
          }

          let settlementResult: SettlementResult | null = null;
          const { merchantId, secretKey } = creds;

          if (o.channel === 'hilogate') {
            const path = `/api/v1/transactions/${o.id}`;
            const url = `${config.api.hilogate.baseUrl}${path}`;
            const sig = generateSignature(path, secretKey);
            const resp = await axios.get(url, {
              headers: { 'X-Merchant-ID': merchantId, 'X-Signature': sig },
              httpsAgent,
              timeout: 15_000
            });
            const tx = resp.data.data;
            const st = (tx.settlement_status || '').toUpperCase();
            if (!['ACTIVE', 'SETTLED', 'COMPLETED'].includes(st)) {
              return;
            }
            settlementResult = {
              netAmt: o.pendingAmount ?? tx.net_amount,
              rrn: tx.rrn || 'N/A',
              st,
              tmt: tx.updated_at ? new Date(tx.updated_at) : undefined
            };
          } else if (o.channel === 'oy') {
            const statusResp = await axios.post(
              'https://partner.oyindonesia.com/api/payment-routing/check-status',
              { partner_trx_id: o.id, send_callback: false },
              { headers: { 'x-oy-username': merchantId, 'x-api-key': secretKey }, httpsAgent, timeout: 15_000 }
            );
            const s = statusResp.data;
            const st = (s.settlement_status || '').toUpperCase();
            if (s.status?.code !== '000' || st === 'WAITING') {
              return;
            }

            const detailResp = await axios.get(
              'https://partner.oyindonesia.com/api/v1/transaction',
              {
                params: { partner_tx_id: o.id, product_type: 'PAYMENT_ROUTING' },
                headers: { 'x-oy-username': merchantId, 'x-api-key': secretKey },
                httpsAgent,
                timeout: 15_000
              }
            );
            const d = detailResp.data.data;
            if (!d || detailResp.data.status?.code !== '000') {
              return;
            }
            settlementResult = {
              netAmt: d.settlement_amount,
              fee: d.admin_fee.total_fee,
              rrn: s.trx_id,
              st,
              tmt: d.settlement_time ? new Date(d.settlement_time) : undefined
            };
          }

          if (!settlementResult) {
            return;
          }

          const key = o.partnerClientId!;
          const arr = groups.get(key) ?? [];
          arr.push({ order: o, settlement: settlementResult });
          groups.set(key, arr);
        } catch (err) {
          logger.error(`[SettlementCron] order ${o.id} failed:`, err);
        }
      })
    )
  );

  const dbLimit = pLimit(DB_CONCURRENCY);
  const txPromises = Array.from(groups.entries()).map(([pcId, items]) =>
    dbLimit(async () => {
      let settledCount = 0;
      let netAmount = 0;
      const chunks = chunk(items, PARTNER_TX_CHUNK_SIZE);
      for (const chunkItems of chunks) {
        try {
          const res = await retryTx(() =>
            prisma.$transaction(async tx => {
              let sc = 0;
              let na = 0;
              for (const { order, settlement } of chunkItems) {
                const upd = await tx.order.updateMany({
                  where: { id: order.id, status: 'PROCESSING' },
                  data: {
                    status: 'SETTLED',
                    settlementAmount: settlement.netAmt,
                    pendingAmount: null,
                    ...(settlement.fee && { fee3rdParty: settlement.fee }),
                    rrn: settlement.rrn,
                    settlementStatus: settlement.st,
                    settlementTime: settlement.tmt,
                    updatedAt: new Date()
                  }
                });
                if (upd.count > 0) {
                  sc++;
                  na += settlement.netAmt;
                  unsettledIds.delete(order.id);
                }
              }
              if (na > 0) {
                await tx.partnerClient.update({
                  where: { id: pcId },
                  data: { balance: { increment: na } }
                });
              }
              return { settledCount: sc, netAmount: na };
            }, { timeout: DB_TX_TIMEOUT_MS })
          );
          settledCount += res.settledCount;
          netAmount += res.netAmount;
        } catch (err) {
          logger.error(`[SettlementCron] partnerClient ${pcId} failed:`, err);
        }
      }
      return { settledCount, netAmount };
    })
  );

  const settled = await Promise.allSettled(txPromises);
  let settledCount = 0;
  let netAmount = 0;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      settledCount += r.value.settledCount;
      netAmount += r.value.netAmount;
    }
  }

  if (unsettledIds.size > 0) {
    try {
      await prisma.order.updateMany({
        where: { id: { in: Array.from(unsettledIds) }, status: 'PROCESSING' },
        data: { status: 'PAID', updatedAt: new Date() }
      });
    } catch (err) {
      logger.error('[SettlementCron] failed to revert orders', err);
    }
  }

  const hasMore = fetchedOrders.length === BATCH_SIZE;
  return { hasMore, settledCount, netAmount, lastCursor };
}

let cutoffTime: Date | null = null;
let settlementTask: ScheduledTask | null = null;
let settlementCronExpr = '0 16 * * *';

async function runSettlementJob() {
  if (!(await tryAdvisoryLock(SETTLEMENT_LOCK_KEY))) {
    logger.info('[SettlementCron] Another settlement job is running, skipping');
    return;
  }
  try {
    cutoffTime = new Date();
    logger.info('[SettlementCron] 🔄 Set cut‑off at ' + cutoffTime.toISOString());
    try {
      await sendTelegramMessage(
        config.api.telegram.adminChannel,
        `[SettlementCron] Starting settlement check at ${cutoffTime.toISOString()}`
      );
    } catch (err) {
      logger.error('[SettlementCron] Failed to send Telegram notification:', err);
    }

    let settledOrders = 0;
    let netAmount = 0;
    let ranIterations = 0;

    if (WORKER_CONCURRENCY <= 1) {
      // sequential mode
      let cursor: Cursor = null;
      while (true) {
        const { settledCount, netAmount: na, lastCursor, hasMore } = await processBatch(cursor);
        if (!settledCount) break;
        settledOrders += settledCount;
        netAmount += na;
        ranIterations++;
        cursor = lastCursor;
        logger.info(`[SettlementCron] Iter ${ranIterations}: settled ${settledCount}`);
        if (!hasMore) break;
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      // concurrent mode
      const cursors: Cursor[] = [];
      let cursor: Cursor = null;
      while (true) {
        const rows = await prisma.order.findMany({
          where: {
            status: 'PAID',
            partnerClientId: { not: null },
            ...(cutoffTime && { createdAt: { lte: cutoffTime } }),
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { gt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { gt: cursor.id } }
                  ]
                }
              : {})
          },
          orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' }
          ],
          take: BATCH_SIZE,
          select: { id: true, createdAt: true }
        });
        if (!rows.length) break;
        cursors.push(cursor);
        const last = rows[rows.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
      }

      const limit = pLimit(WORKER_CONCURRENCY);
      const results = await Promise.all(
        cursors.map(c => limit(() => processBatch(c)))
      );
      ranIterations = results.length;
      for (const r of results) {
        settledOrders += r.settledCount;
        netAmount += r.netAmount;
      }
    }

    try {
      await sendTelegramMessage(
        config.api.telegram.adminChannel,
        `[SettlementCron] Summary: iterations ${ranIterations}, settled ${settledOrders} orders, net amount ${netAmount}`
      );
    } catch (err) {
      logger.error('[SettlementCron] Failed to send Telegram summary:', err);
    }
  } catch (err) {
    logger.error('[SettlementCron] Unexpected error:', err);
    try {
      if (config.api.telegram.adminChannel) {
        await sendTelegramMessage(
          config.api.telegram.adminChannel,
          `[SettlementCron] Fatal error: ${err instanceof Error ? err.message : err}`
        );
      }
    } catch (telegramErr) {
      logger.error('[SettlementCron] Failed to send Telegram alert:', telegramErr);
    }
  } finally {
    await releaseAdvisoryLock(SETTLEMENT_LOCK_KEY)
  }
}

function createTask(expr: string) {
  return cron.schedule(expr, runSettlementJob, { timezone: 'Asia/Jakarta' });
}

export async function scheduleSettlementChecker() {
  process.on('SIGINT', () => {
    logger.info('[SettlementCron] SIGINT, shutdown…');
  });
  process.on('SIGTERM', () => {
    logger.info('[SettlementCron] SIGTERM, shutdown…');
  });

  logger.info('[SettlementCron] ⏳ Waiting for scheduled settlement time');

  const setting = await prisma.setting.findUnique({ where: { key: 'settlement_cron' } });
  const expr = setting?.value || '0 16 * * *';
  settlementCronExpr = expr;
  settlementTask = createTask(expr);
}

export function restartSettlementChecker(expr: string) {
  settlementTask?.stop();
  settlementTask?.destroy();
  settlementCronExpr = expr || settlementCronExpr || '0 16 * * *';
  settlementTask = createTask(settlementCronExpr);
}

export function resetSettlementState() {
  settlementTask?.stop();
  settlementTask?.destroy();
  settlementTask = null;
  cutoffTime = null;
}

export async function runManualSettlement(
  onProgress?: (p: {
    settledOrders: number
    netAmount: number
    batchSettled: number
    batchAmount: number
  }) => void
) {
  if (!(await tryAdvisoryLock(SETTLEMENT_LOCK_KEY))) {
    logger.info('[SettlementCron] Manual settlement already running, skipping')
    return { settledOrders: 0, netAmount: 0 }
  }
  try {
    cutoffTime = new Date()

    let settledOrders = 0
    let netAmount = 0
    let cursor: Cursor = null

    while (true) {
      const { settledCount, netAmount: na, lastCursor } = await processBatch(cursor)
      if (!settledCount) break
      settledOrders += settledCount
      netAmount += na
      cursor = lastCursor
      onProgress?.({
        settledOrders,
        netAmount,
        batchSettled: settledCount,
        batchAmount: na,
      })
    }

    return { settledOrders, netAmount }
  } finally {
    await releaseAdvisoryLock(SETTLEMENT_LOCK_KEY)
  }
}
