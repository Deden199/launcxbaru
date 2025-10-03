import cron, { ScheduledTask } from 'node-cron'
import os from 'os'
import pLimit from 'p-limit'
import { prisma } from '../core/prisma'
import { config } from '../config'
import logger from '../logger'
import { sendTelegramMessage } from '../core/telegram.axios'
import { tryAdvisoryLock, releaseAdvisoryLock } from '../util/dbLock'
import {
  createManualSettlementProcessor,
  type PendingSettlementOrder,
  type SettlementContext,
} from '../service/manualSettlement'

// ————————— CONFIG —————————
const BATCH_SIZE = 1500                          // jumlah order PAID diproses per batch
const DB_CONCURRENCY   = Number(process.env.DB_CONCURRENCY ?? os.cpus().length) // parallel DB transactions
const WORKER_CONCURRENCY = Number(process.env.SETTLEMENT_WORKERS ?? 1)
const DB_TX_TIMEOUT_MS = Number(process.env.SETTLEMENT_DB_TX_TIMEOUT_MS ?? 15_000)
const SETTLEMENT_LOCK_KEY = 1_234_567_890

type Cursor = { createdAt: Date; id: string } | null

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

type BatchResult = {
  hasMore: boolean;
  settledCount: number;
  netAmount: number;
  lastCursor: Cursor;
};

const settlementProcessor = createManualSettlementProcessor({
  retryTx,
  dbConcurrency: DB_CONCURRENCY,
  dbTxTimeoutMs: DB_TX_TIMEOUT_MS,
});

// core worker: proses satu batch; return object with stats
async function processBatch(cursor: Cursor, context: SettlementContext): Promise<BatchResult> {
  const where: any = {
    status: 'PAID',
    partnerClientId: { not: null },
    ...(cutoffTime && { createdAt: { lte: cutoffTime } }),
    ...(cursor
      ? {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        }
      : {}),
  }

  const fetchedOrders = await prisma.order.findMany({
    where,
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    take: BATCH_SIZE,
    select: {
      id: true,
      partnerClientId: true,
      amount: true,
      pendingAmount: true,
      feeLauncx: true,
      fee3rdParty: true,
      settlementStatus: true,
      settlementTime: true,
      status: true,
      createdAt: true,
      partnerClient: { select: { feePercent: true, feeFlat: true } },
    },
  })

  if (!fetchedOrders.length) {
    return { hasMore: false, settledCount: 0, netAmount: 0, lastCursor: cursor }
  }

  const last = fetchedOrders[fetchedOrders.length - 1]
  const lastCursor: Cursor = { createdAt: last.createdAt, id: last.id }

  const claimLimit = pLimit(DB_CONCURRENCY)
  const claimedOrders: PendingSettlementOrder[] = []
  await Promise.all(
    fetchedOrders.map(o =>
      claimLimit(async () => {
        const upd = await prisma.order.updateMany({
          where: { id: o.id, status: 'PAID' },
          data: { status: 'PROCESSING', updatedAt: new Date() },
        })
        if (upd.count > 0) {
          claimedOrders.push({
            id: o.id,
            partnerClientId: o.partnerClientId,
            amount: o.amount,
            pendingAmount: o.pendingAmount,
            feeLauncx: o.feeLauncx,
            fee3rdParty: o.fee3rdParty,
            settlementStatus: o.settlementStatus,
            settlementTime: o.settlementTime,
            status: 'PROCESSING',
            createdAt: o.createdAt,
            partnerClient: o.partnerClient,
          })
        }
      }),
    ),
  )

  if (!claimedOrders.length) {
    return { hasMore: fetchedOrders.length === BATCH_SIZE, settledCount: 0, netAmount: 0, lastCursor }
  }

  logger.info(`[SettlementCron] processing ${claimedOrders.length} orders`)

  const unsettledIds = new Set(claimedOrders.map(o => o.id))
  const { settled, netAmount, settledOrderIds } = await settlementProcessor.processOrders(claimedOrders, context)
  for (const id of settledOrderIds) {
    unsettledIds.delete(id)
  }

  if (unsettledIds.size > 0) {
    try {
      await prisma.order.updateMany({
        where: { id: { in: Array.from(unsettledIds) }, status: 'PROCESSING' },
        data: { status: 'PAID', updatedAt: new Date() },
      })
    } catch (err) {
      logger.error('[SettlementCron] failed to revert orders', err)
    }
  }

  const hasMore = fetchedOrders.length === BATCH_SIZE
  return { hasMore, settledCount: settled, netAmount, lastCursor }
}

let cutoffTime: Date | null = null;
let settlementTask: ScheduledTask | null = null;
let settlementCronExpr = '0 16 * * *';

async function runSettlementJob() {
  if (!(await tryAdvisoryLock(SETTLEMENT_LOCK_KEY))) {
    logger.info('[SettlementCron] Another settlement job is running, skipping');
    return;
  }
  let jobId: string | null = null;
  let jobContext: SettlementContext | null = null;
  try {
    cutoffTime = new Date();
    jobId = `cron:${cutoffTime.toISOString()}`;
    jobContext = { trigger: 'cron', jobId, actor: 'system' };
    logger.info(`[SettlementCron:${jobId}] 🔄 Set cut‑off at ${cutoffTime.toISOString()}`);
    try {
      await sendTelegramMessage(
        config.api.telegram.adminChannel,
        `[SettlementCron:${jobId}] Starting settlement check at ${cutoffTime.toISOString()}`
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
        const { settledCount, netAmount: na, lastCursor, hasMore } = await processBatch(cursor, jobContext!);
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
        cursors.map(c => limit(() => processBatch(c, jobContext!)))
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
        `[SettlementCron:${jobId}] Summary: iterations ${ranIterations}, settled ${settledOrders} orders, net amount ${netAmount}`
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
          `[SettlementCron${jobId ? `:${jobId}` : ''}] Fatal error: ${err instanceof Error ? err.message : err}`
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

export interface ManualSettlementOptions {
  onProgress?: (p: {
    settledOrders: number
    netAmount: number
    batchSettled: number
    batchAmount: number
  }) => void
  context?: SettlementContext
}

export async function runManualSettlement(options: ManualSettlementOptions = {}) {
  if (!(await tryAdvisoryLock(SETTLEMENT_LOCK_KEY))) {
    logger.info('[SettlementCron] Manual settlement already running, skipping')
    return { settledOrders: 0, netAmount: 0 }
  }
  try {
    cutoffTime = new Date()
    const jobContext: SettlementContext = {
      trigger: options.context?.trigger ?? 'manual',
      jobId: options.context?.jobId ?? `manual:${cutoffTime.toISOString()}`,
      actor: options.context?.actor,
    }

    let settledOrders = 0
    let netAmount = 0
    let cursor: Cursor = null

    while (true) {
      const { settledCount, netAmount: na, lastCursor } = await processBatch(cursor, jobContext)
      if (!settledCount) break
      settledOrders += settledCount
      netAmount += na
      cursor = lastCursor
      options.onProgress?.({
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
