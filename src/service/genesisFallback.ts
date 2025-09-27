import logger from '../logger'
import { prisma } from '../core/prisma'
import { GenesisClient, GenesisClientConfig } from './genesisClient'
import { processPiroUpdate } from './piroStatus'

interface WatcherState {
  attempts: number
  timer?: NodeJS.Timeout
}

interface GenesisFallbackOptions {
  clientId: string
  clientSecret: string
  referenceId?: string
  paymentId?: string | null
}

const BACKOFF_MINUTES = [3, 10, 30]
const watchers = new Map<string, WatcherState>()

export function cancelGenesisFallback(orderId: string) {
  const state = watchers.get(orderId)
  if (state?.timer) clearTimeout(state.timer)
  watchers.delete(orderId)
}

export function scheduleGenesisFallback(
  orderId: string,
  cfg: GenesisClientConfig,
  opts: GenesisFallbackOptions,
) {
  if (!orderId) return
  if (watchers.has(orderId)) return

  const client = new GenesisClient(cfg)
  const state: WatcherState = { attempts: 0 }

  const runCheck = async () => {
    try {
      const existingCb = await prisma.transaction_callback.findFirst({
        where: { referenceId: orderId },
      })
      if (existingCb) {
        cancelGenesisFallback(orderId)
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
        cancelGenesisFallback(orderId)
        return
      }

      const reference = opts.referenceId ?? order.pgClientRef ?? orderId
      const resp = await client.queryQris({
        orderId: reference,
        clientId: opts.clientId || cfg.defaultClientId,
        clientSecret: opts.clientSecret || cfg.defaultClientSecret || cfg.secret,
      })

      const statusUpper = (resp.status || '').toUpperCase()
      if (
        ['SUCCESS', 'PAID', 'DONE', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(statusUpper)
      ) {
        await processPiroUpdate({
          orderId,
          status: statusUpper,
          paymentId: resp.tx ?? opts.paymentId ?? order.pgRefId ?? null,
          referenceId: resp.orderId ?? reference,
          grossAmount: resp.amount,
          paymentReceivedTime: resp.paidTime ?? undefined,
          raw: resp.raw,
        })
        cancelGenesisFallback(orderId)
        return
      }
    } catch (err: any) {
      logger.error(`[GenesisFallback] error for ${orderId}: ${err.message}`)
    }

    state.attempts += 1
    if (state.attempts >= BACKOFF_MINUTES.length) {
      cancelGenesisFallback(orderId)
      return
    }

    const delayMs = BACKOFF_MINUTES[state.attempts] * 60 * 1000
    state.timer = setTimeout(runCheck, delayMs)
    watchers.set(orderId, state)
  }

  const initialDelay = BACKOFF_MINUTES[0] * 60 * 1000
  state.timer = setTimeout(runCheck, initialDelay)
  watchers.set(orderId, state)
  logger.info(`[GenesisFallback] scheduled watcher for ${orderId}`)
}
