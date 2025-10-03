import { Prisma } from '@prisma/client'
import pLimit from 'p-limit'
import { prisma } from '../core/prisma'
import logger from '../logger'
import { computeSettlement } from './feeSettlement'
import { postPartnerCredit } from './balanceLedger'

export interface SettlementContext {
  jobId?: string
  actor?: string
  trigger?: 'cron' | 'manual' | 'worker'
}

export interface PendingSettlementOrder {
  id: string
  partnerClientId: string | null
  amount: number
  pendingAmount: number | null
  feeLauncx: number | null
  fee3rdParty: number | null
  settlementStatus: string | null
  settlementTime: Date | null
  status: string
  createdAt: Date
  partnerClient?: {
    feePercent: number | null
    feeFlat: number | null
  } | null
}

export interface ProcessOrderResult {
  settled: boolean
  netAmount: number
}

export interface ManualSettlementProcessorOptions {
  dbConcurrency?: number
  dbTxTimeoutMs?: number
  now?: () => Date
  retryTx: <T>(fn: () => Promise<T>) => Promise<T>
}

const DEFAULT_DB_CONCURRENCY = 4

export class ManualSettlementProcessor {
  private readonly dbConcurrency: number
  private readonly nowFn: () => Date
  private readonly dbTxTimeoutMs?: number

  constructor(private readonly options: ManualSettlementProcessorOptions) {
    this.dbConcurrency = Math.max(1, options.dbConcurrency ?? DEFAULT_DB_CONCURRENCY)
    this.nowFn = options.now ?? (() => new Date())
    this.dbTxTimeoutMs = options.dbTxTimeoutMs
  }

  async processOrders(
    orders: PendingSettlementOrder[],
    context: SettlementContext,
  ): Promise<{ settled: number; netAmount: number; settledOrderIds: string[] }> {
    if (!orders.length) {
      return { settled: 0, netAmount: 0, settledOrderIds: [] }
    }

    const limit = pLimit(this.dbConcurrency)
    let settledCount = 0
    let netAmount = 0
    const settledOrderIds: string[] = []

    await Promise.all(
      orders.map(order =>
        limit(async () => {
          try {
            const result = await this.processOrder(order, context)
            if (result.settled) {
              settledCount += 1
              netAmount += result.netAmount
              settledOrderIds.push(order.id)
            }
          } catch (err) {
            logger.error(
              `[ManualSettlementProcessor] Failed settling order ${order.id} (jobId=${context.jobId ?? 'n/a'})`,
              err,
            )
          }
        }),
      ),
    )

    return { settled: settledCount, netAmount, settledOrderIds }
  }

  private async processOrder(order: PendingSettlementOrder, context: SettlementContext): Promise<ProcessOrderResult> {
    if (!order.partnerClientId) {
      return { settled: false, netAmount: 0 }
    }

    return this.options.retryTx(async () => {
      return prisma.$transaction(async tx => {
        const existing = await tx.order.findUnique({
          where: { id: order.id },
          select: {
            id: true,
            status: true,
            settlementTime: true,
            settlementAmount: true,
            pendingAmount: true,
            amount: true,
            feeLauncx: true,
            partnerClientId: true,
            settlementStatus: true,
          },
        })

        if (!existing || existing.partnerClientId !== order.partnerClientId) {
          return { settled: false, netAmount: 0 }
        }

        if (existing.status === 'SETTLED' || existing.settlementTime) {
          return { settled: false, netAmount: 0 }
        }

        if (existing.status !== 'PROCESSING') {
          return { settled: false, netAmount: 0 }
        }

        const ledgerRef = `SETTLE:${order.id}`

        let ledgerEntry: any = null
        if ((tx as any).partnerBalanceLedger?.findUnique) {
          ledgerEntry = await (tx as any).partnerBalanceLedger.findUnique({ where: { reference: ledgerRef } })
        }
        if (ledgerEntry) {
          if (existing.status !== 'SETTLED') {
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: 'SETTLED',
                settlementStatus: existing.settlementStatus ?? 'SETTLED',
                settlementAmount: ledgerEntry.amount ?? existing.settlementAmount ?? order.pendingAmount ?? 0,
                pendingAmount: null,
                settlementTime: existing.settlementTime ?? ledgerEntry.createdAt ?? this.nowFn(),
                updatedAt: this.nowFn(),
                feeLauncx: existing.feeLauncx ?? order.feeLauncx ?? null,
              },
            })
          }
          return { settled: false, netAmount: 0 }
        }

        const partnerFeePercent = order.partnerClient?.feePercent ?? 0
        const partnerFeeFlat = order.partnerClient?.feeFlat ?? 0
        const computed = computeSettlement(existing.amount ?? order.amount, {
          percent: partnerFeePercent,
          flat: partnerFeeFlat,
        })

        const settlementAmount = existing.pendingAmount ?? order.pendingAmount ?? computed.settlement
        if (!Number.isFinite(settlementAmount) || settlementAmount <= 0) {
          return { settled: false, netAmount: 0 }
        }

        const feeLauncx = existing.feeLauncx ?? order.feeLauncx ?? computed.fee

        const ledgerResult = await postPartnerCredit(tx as unknown as Prisma.TransactionClient, {
          partnerClientId: order.partnerClientId,
          amount: settlementAmount,
          reference: ledgerRef,
          description: 'Settlement credit',
          metadata: { orderId: order.id },
          actor: context.actor ?? null,
          jobId: context.jobId ?? null,
        })

        if (ledgerResult.duplicate) {
          const existingLedger = (tx as any).partnerBalanceLedger?.findUnique
            ? await (tx as any).partnerBalanceLedger.findUnique({ where: { reference: ledgerRef } })
            : null
          if (existingLedger && existing.status !== 'SETTLED') {
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: 'SETTLED',
                settlementStatus: existing.settlementStatus ?? 'SETTLED',
                settlementAmount: existingLedger.amount ?? settlementAmount,
                pendingAmount: null,
                settlementTime: existing.settlementTime ?? existingLedger.createdAt ?? this.nowFn(),
                updatedAt: this.nowFn(),
                feeLauncx,
              },
            })
          }
          return { settled: false, netAmount: 0 }
        }

        const settlementTime = this.nowFn()

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'SETTLED',
            settlementStatus: 'SETTLED',
            settlementAmount,
            pendingAmount: null,
            settlementTime,
            updatedAt: settlementTime,
            feeLauncx,
          },
        })

        return { settled: true, netAmount: settlementAmount }
      }, this.dbTxTimeoutMs ? { timeout: this.dbTxTimeoutMs } : undefined)
    })
  }
}

export function createManualSettlementProcessor(options: ManualSettlementProcessorOptions) {
  return new ManualSettlementProcessor(options)
}
