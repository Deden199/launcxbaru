import logger from '../logger';
import { prisma } from '../core/prisma';
import { Ing1Client, Ing1Config } from './ing1Client';
import { parseIng1Date, parseIng1Number, processIng1Update } from './ing1Status';

interface FallbackOptions {
  reff?: string | null;
  clientReff?: string | null;
}

const BACKOFF_MINUTES = [3, 10, 40];

interface WatcherState {
  attempts: number;
  timer?: NodeJS.Timeout;
}

const watchers = new Map<string, WatcherState>();

function scheduleNext(orderId: string, state: WatcherState, delayMs: number, runner: () => void) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = setTimeout(runner, delayMs);
  watchers.set(orderId, state);
}

export function cancelIng1Fallback(orderId: string) {
  const state = watchers.get(orderId);
  if (state?.timer) {
    clearTimeout(state.timer);
  }
  watchers.delete(orderId);
}

export function scheduleIng1Fallback(
  orderId: string,
  cfg: Ing1Config,
  opts: FallbackOptions = {}
) {
  if (!orderId) return;
  if (watchers.has(orderId)) return;

  const client = new Ing1Client(cfg);
  const state: WatcherState = { attempts: 0 };

  const runCheck = async () => {
    try {
      const existingCallback = await prisma.transaction_callback.findFirst({
        where: { referenceId: orderId },
      });
      if (existingCallback) {
        cancelIng1Fallback(orderId);
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          pgRefId: true,
          pgClientRef: true,
        },
      });

      if (!order || order.status !== 'PENDING') {
        cancelIng1Fallback(orderId);
        return;
      }

      const reff = opts.reff ?? order.pgRefId ?? undefined;
      const clientReff = opts.clientReff ?? order.pgClientRef ?? orderId;

      if (!reff) {
        cancelIng1Fallback(orderId);
        return;
      }

      const resp = await client.checkCashin({ reff, clientReff });
      if (resp.status === 'PAID' || resp.status === 'FAILED') {
        const data = resp.data ?? {};
        await processIng1Update({
          orderId,
          rc: resp.rc,
          statusText: (data.status as string) ?? resp.status,
          billerReff: resp.reff ?? reff,
          clientReff: resp.clientReff ?? clientReff,
          grossAmount:
            parseIng1Number(data.total ?? data.amount ?? data.gross_amount ?? data.grossAmount) ?? undefined,
          paymentReceivedTime:
            parseIng1Date(data.paid_at ?? data.payment_received_time ?? data.paidAt) ?? undefined,
          settlementTime:
            parseIng1Date(data.settlement_time ?? data.settled_at ?? data.settlementTime) ?? undefined,
          expirationTime:
            parseIng1Date(data.expired_at ?? data.expiration_time ?? data.expirationTime) ?? undefined,
        });
        cancelIng1Fallback(orderId);
        return;
      }
    } catch (err: any) {
      logger.error(`[ing1Fallback] error for ${orderId}: ${err.message}`);
    }

    state.attempts += 1;
    if (state.attempts >= BACKOFF_MINUTES.length) {
      cancelIng1Fallback(orderId);
      return;
    }

    const delayMs = BACKOFF_MINUTES[state.attempts] * 60 * 1000;
    scheduleNext(orderId, state, delayMs, runCheck);
  };

  watchers.set(orderId, state);
  const initialDelay = BACKOFF_MINUTES[0] * 60 * 1000;
  scheduleNext(orderId, state, initialDelay, runCheck);
  logger.info(`[ing1Fallback] scheduled watcher for ${orderId}`);
}
