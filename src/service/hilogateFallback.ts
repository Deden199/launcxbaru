import { prisma } from '../core/prisma';
import logger from '../logger';
import { HilogateClient, HilogateConfig } from './hilogateClient';
import { processHilogatePayload } from './payment';
import moment from 'moment-timezone';

const FINAL_STATUSES = ['SUCCESS', 'EXPIRED', 'FAILED', 'COMPLETED'];

export function evaluateFinalStatus(resp: any): string | null {
  const status = resp?.data?.status ?? resp?.status;
  return FINAL_STATUSES.includes((status || '').toUpperCase())
    ? (status || '').toUpperCase()
    : null;
}

async function resendCallback(refId: string, cfg: HilogateConfig) {
  try {
    logger.info(`[hilogateFallback] resend callback for ${refId}`);
    const client = new HilogateClient(cfg);
    const resp = await client.getTransaction(refId);
    const data = resp.data ?? resp;
    await processHilogatePayload({
      ref_id: data.ref_id,
      amount: data.amount,
      method: data.method,
      status: data.status,
      net_amount: data.net_amount ?? data.settlement_amount,
      qr_string: data.qr_string,
      settlement_status: data.settlement_status,
    });
    logger.info(`[hilogateFallback] resend processed for ${refId}`);
  } catch (err: any) {
    logger.error(`[hilogateFallback] resend error for ${refId}: ${err.message}`);
  }
}

export async function scheduleHilogateFallback(refId: string, cfg: HilogateConfig) {
  const delayMs = 3 * 60 * 1000;
  const nextRetry = moment().tz('Asia/Jakarta').add(delayMs, 'ms').toDate();

  try {
    await prisma.hilogateCallbackWatcher.upsert({
      where: { refId },
      update: { attemptCount: 0, processed: false, nextRetryAt: nextRetry },
      create: { refId, attemptCount: 0, processed: false, nextRetryAt: nextRetry },
    });
  } catch (err: any) {
    logger.error(`[hilogateFallback] failed to register watcher for ${refId}: ${err.message}`);
    return;
  }

  const checkAndResend = async () => {
    try {
      const watcher = await prisma.hilogateCallbackWatcher.findUnique({
        where: { refId },
      });
      if (!watcher || watcher.processed) return;

      const cb = await prisma.transaction_callback.findFirst({
        where: { referenceId: refId },
      });
      if (cb) {
        await prisma.hilogateCallbackWatcher.update({
          where: { refId },
          data: { processed: true },
        });
        return;
      }

      logger.info(`[hilogateFallback] fetching status for ${refId}`);
      const client = new HilogateClient(cfg);
      const resp = await client.getTransaction(refId);
      const status = evaluateFinalStatus(resp);
      if (status) {
        await resendCallback(refId, cfg);
        await prisma.hilogateCallbackWatcher.update({
          where: { refId },
          data: { processed: true, attemptCount: watcher.attemptCount + 1 },
        });
        return;
      }

      const attempts = watcher.attemptCount + 1;
      const backoffs = [10, 40];
      if (attempts >= 3) {
        await prisma.hilogateCallbackWatcher.update({
          where: { refId },
          data: { attemptCount: attempts },
        });
        return;
      }
      const nextDelay = backoffs[attempts - 1] * 60 * 1000;
      const nextTime = moment().tz('Asia/Jakarta').add(nextDelay, 'ms').toDate();
      await prisma.hilogateCallbackWatcher.update({
        where: { refId },
        data: { attemptCount: attempts, nextRetryAt: nextTime },
      });
      setTimeout(checkAndResend, nextDelay);
    } catch (err: any) {
      logger.error(`[hilogateFallback] error for ${refId}: ${err.message}`);
    }
  };

  setTimeout(checkAndResend, delayMs);
}
