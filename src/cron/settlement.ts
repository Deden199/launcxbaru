import cron from 'node-cron'
import axios from 'axios'
import https from 'https'
import os from 'os'
import pLimit from 'p-limit'
import { prisma } from '../core/prisma'
import { config } from '../config'
import crypto from 'crypto'
import logger from '../logger'
import { sendTelegramMessage } from '../core/telegram.axios'

// ————————— CONFIG —————————
const BATCH_SIZE = 1000                          // jumlah order PAID diproses per batch
const HTTP_CONCURRENCY = Math.max(10, os.cpus().length * 2)
const DB_CONCURRENCY   = 1                      // turunkan ke 1 untuk hindari write conflict

let lastCreatedAt: Date | null = null;
let lastId: string | null = null;
let running = true;
let isRunning = false;

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
      if (i < attempts - 1 && msg.includes('write conflict')) {
        const delay = baseDelayMs * 2 ** i;
        logger.warn(
          `[SettlementCron] retryTx attempt ${i + 1} failed (write conflict), retrying in ${delay}ms…`,
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

type SettlementResult = { netAmt: number; rrn: string; st: string; tmt?: Date; fee?: number };

// core worker: proses satu batch; return true jika masih ada data
async function processBatchOnce(): Promise<boolean> {
  // cursor-based pagination
const where: any = {
  status: 'PAID',
  partnerClientId: { not: null },

  // hanya sampai cut‑off
  ...(cutoffTime && { createdAt: { lte: cutoffTime } }),

  ...(lastCreatedAt && lastId
    ? {
        OR: [
          { createdAt: { gt: lastCreatedAt } },
          { createdAt: lastCreatedAt, id: { gt: lastId } }
        ]
      }
    : {})
};


  const pendingOrders = await prisma.order.findMany({
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

  if (!pendingOrders.length) {
    return false;
  }

  // update cursor
  const last = pendingOrders[pendingOrders.length - 1];
  lastCreatedAt = last.createdAt;
  lastId = last.id;

  logger.info(`[SettlementCron] processing ${pendingOrders.length} orders`);

  const httpLimit = pLimit(HTTP_CONCURRENCY);
  const dbLimit = pLimit(DB_CONCURRENCY);

  const txPromises = pendingOrders.map(o =>
    httpLimit(async () => {
      try {
        const creds =
          o.subMerchant?.credentials as { merchantId: string; secretKey: string } | undefined;
        if (!creds) {
          return null;
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
            return null;
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
            return null;
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
            return null;
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
          return null;
        }

        // idempotent update dengan updateMany + count check
        return dbLimit(() =>
          retryTx(() =>
            prisma.$transaction(async tx => {
              const upd = await tx.order.updateMany({
                where: { id: o.id, status: 'PAID' },
                data: {
                  status: 'SETTLED',
                  settlementAmount: settlementResult.netAmt,
                  pendingAmount: null,
                  ...(settlementResult.fee && { fee3rdParty: settlementResult.fee }),
                  rrn: settlementResult.rrn,
                  settlementStatus: settlementResult.st,
                  settlementTime: settlementResult.tmt,
                  updatedAt: new Date()
                }
              });
              if (upd.count > 0) {
                await tx.partnerClient.update({
                  where: { id: o.partnerClientId! },
                  data: { balance: { increment: settlementResult.netAmt } }
                });
              }
            })
          )
        );
      } catch (err) {
        logger.error(`[SettlementCron] order ${o.id} failed:`, err);
        return null;
      }
    })
  );

  await Promise.allSettled(txPromises);
  return true;
}

// safe runner untuk batch loop dengan limit
async function processBatchLoop() {
  let batches = 0;
  const MAX_BATCHES = Math.min(Number(process.env.SETTLEMENT_MAX_BATCHES) || 50, 100);
  // env SETTLEMENT_MAX_BATCHES defaults to 50 and is capped at 100 to avoid resource exhaustion
  while (running && batches < MAX_BATCHES && (await processBatchOnce())) {
    batches++;
    logger.info(`[SettlementCron] ✅ Batch #${batches} complete at ${new Date().toISOString()}`);
  }
  if (batches === MAX_BATCHES) {
    logger.info(
      `[SettlementCron] reached max ${MAX_BATCHES} batches, deferring remaining to next interval`
    );
  }
}

// wrapper untuk prevent overlap
async function safeRun() {
  if (!running || isRunning) {
    return;
  }
  isRunning = true;
  try {
    await processBatchLoop();
  } finally {
    isRunning = false;
  }
}
let cutoffTime: Date | null = null;

export function scheduleSettlementChecker() {
  if (!running) return;

  process.on('SIGINT', () => { running = false; logger.info('[SettlementCron] SIGINT, shutdown…'); });
  process.on('SIGTERM', () => { running = false; logger.info('[SettlementCron] SIGTERM, shutdown…'); });

  ;(async () => {
    // sekali jalan di startup (drain backlog terakhir, jika diperlukan)
    await safeRun();
    logger.info('[SettlementCron] 🏁 Backlog drained, entering scheduled mode');

    // 1) Harian jam 17:00: reset cursor & cut‑off
    cron.schedule(
      '0 17 * * *',
      async () => {
        cutoffTime    = new Date();
        lastCreatedAt = null;
        lastId        = null;
        logger.info('[SettlementCron] 🔄 Reset cursor & set cut‑off at ' + cutoffTime.toISOString());
        try {
          await sendTelegramMessage(
            config.api.telegram.adminChannel,
            `[SettlementCron] Starting settlement check at ${cutoffTime.toISOString()}`
          );
        } catch (err) {
          logger.error('[SettlementCron] Failed to send Telegram notification:', err);
        }
        await safeRun();
      },
      { timezone: 'Asia/Jakarta' }
    );

    // 2) Polling tiap 5 menit 17:00–20:00
    cron.schedule(
      '*/5 18-20 * * *',
      async () => {
        if (!running) return;
        logger.info('[SettlementCron] ⏱ Polling tick at ' + new Date().toISOString());
        await safeRun();
      },
      { timezone: 'Asia/Jakarta' }
    );
  })();
}
