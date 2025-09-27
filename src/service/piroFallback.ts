import logger from '../logger'
import { prisma } from '../core/prisma'
import { PiroClient, PiroConfig } from './piroClient'
import { processPiroUpdate } from './piroStatus'

interface WatcherState {
  attempts: number
  timer?: NodeJS.Timeout
}

const BACKOFF_MINUTES = [3, 10, 30]
const watchers = new Map<string, WatcherState>()

export function cancelPiroFallback(orderId: string) {
  const state = watchers.get(orderId)
  if (state?.timer) clearTimeout(state.timer)
  watchers.delete(orderId)
}

interface FallbackOptions {
  paymentId?: string | null
  referenceId?: string | null
}

export function schedulePiroFallback(
  orderId: string,
  cfg: PiroConfig,
  opts: FallbackOptions = {}
) {
  if (!orderId) return
  if (watchers.has(orderId)) return

  const client = new PiroClient(cfg)
  const state: WatcherState = { attempts: 0 }

  const runCheck = async () => {
    try {
      const existingCb = await prisma.transaction_callback.findFirst({
        where: { referenceId: orderId },
      })
      if (existingCb) {
        cancelPiroFallback(orderId)
        return
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          pgRefId: true,
          pgClientRef: true,
        },
      })

      if (!order || order.status !== 'PENDING') {
        cancelPiroFallback(orderId)
        return
      }

      const inquiry =
        opts.paymentId ??
        order.pgRefId ??
        opts.referenceId ??
        order.pgClientRef ??
        orderId

      const resp = await client.getPaymentStatus(inquiry)
      const statusUpper = (resp.status || '').toUpperCase()
      if (
        ['SUCCESS', 'PAID', 'DONE', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(
          statusUpper
        )
      ) {
        await processPiroUpdate({
          orderId,
          status: statusUpper,
          paymentId: resp.paymentId,
          referenceId: resp.referenceId,
          grossAmount: resp.grossAmount,
          netAmount: resp.netAmount,
          feeAmount: resp.feeAmount,
          checkoutUrl: resp.checkoutUrl,
          qrContent: resp.qrContent,
          paymentReceivedTime: resp.paidAt ?? undefined,
          settlementTime: resp.settledAt ?? undefined,
          expirationTime: resp.expiredAt ?? undefined,
          raw: resp.raw,
        })
        cancelPiroFallback(orderId)
        return
      }
    } catch (err: any) {
      logger.error(`[PiroFallback] error for ${orderId}: ${err.message}`)
    }

    state.attempts += 1
    if (state.attempts >= BACKOFF_MINUTES.length) {
      cancelPiroFallback(orderId)
      return
    }

    const delayMs = BACKOFF_MINUTES[state.attempts] * 60 * 1000
    state.timer = setTimeout(runCheck, delayMs)
    watchers.set(orderId, state)
  }

  const initialDelay = BACKOFF_MINUTES[0] * 60 * 1000
  state.timer = setTimeout(runCheck, initialDelay)
  watchers.set(orderId, state)
  logger.info(`[PiroFallback] scheduled watcher for ${orderId}`)
}
