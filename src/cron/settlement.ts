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

type BatchResult = {
  hasMore: boolean;
  settledCount: number;
  netAmount: number;
};

// core worker: proses satu batch; return object with stats
async function processBatchOnce(): Promise<BatchResult> {
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
    return { hasMore: false, settledCount: 0, netAmount: 0 };
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
          return 0;
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
            return 0;
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
            return 0;
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
            return 0;
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
          return 0;
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
                return settlementResult.netAmt;
              }
              return 0;
            })
          )
        );
      } catch (err) {
        logger.error(`[SettlementCron] order ${o.id} failed:`, err);
        return 0;
      }
    })
  );

  const settled = await Promise.allSettled(txPromises);
  let settledCount = 0;
  let netAmount = 0;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      const val = r.value as number;
      if (val > 0) {
        settledCount++;
        netAmount += val;
      }
    }
  }

  return { hasMore: true, settledCount, netAmount };
}

// safe runner: process up to a single batch
async function processBatchLoop(): Promise<{ settledCount: number; netAmount: number }> {
  const { settledCount, netAmount } = await processBatchOnce();
  return { settledCount, netAmount };
}

let cutoffTime: Date | null = null;

export function scheduleSettlementChecker() {
  process.on('SIGINT', () => { logger.info('[SettlementCron] SIGINT, shutdown…'); });
  process.on('SIGTERM', () => { logger.info('[SettlementCron] SIGTERM, shutdown…'); });

  logger.info('[SettlementCron] ⏳ Waiting for scheduled settlement time');

  // Harian jam 16:00: set cut‑off & process batches
  cron.schedule(
    '0 16 * * *',
    async () => {
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

 // Hitung total batch yang dibutuhkan
const total = await prisma.order.count({
  where: {
    status: 'PAID',
    partnerClientId: { not: null },
    createdAt: { lte: cutoffTime }
  }
});
const iterations = Math.ceil(total / BATCH_SIZE);

// Reset cursor ONCE sebelum loop
lastCreatedAt = null;
lastId        = null;

let settledOrders = 0;
let netAmount     = 0;
let ranIterations = 0;

for (let i = 0; i < iterations; i++) {
  // Proses satu batch berikutnya
  const { settledCount, netAmount: na } = await processBatchOnce();
  if (!settledCount) break;           // berhenti kalau tidak ada yang tersettle
  settledOrders += settledCount;
  netAmount     += na;
  ranIterations++;
  logger.info(`[SettlementCron] Iter ${i+1}/${iterations}: settled ${settledCount}`);
  await new Promise(r => setTimeout(r, 500));  // jeda ringan
}

      try {
// Kirim ringkasan hasil
await sendTelegramMessage(
  config.api.telegram.adminChannel,
  `[SettlementCron] Summary: iterations ${ranIterations}, settled ${settledOrders} orders, net amount ${netAmount}`
);

      } catch (err) {
        logger.error('[SettlementCron] Failed to send Telegram summary:', err);
      }
    },
    { timezone: 'Asia/Jakarta' }
  );

}
