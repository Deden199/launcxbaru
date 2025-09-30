import moment from 'moment-timezone'
import { prisma } from '../core/prisma'
import { computeSettlement } from './feeSettlement'

type FeeConfig = number | Record<string, number>

const JAKARTA_TZ = 'Asia/Jakarta'

const prismaTxTimeoutMs = (() => {
  const rawTimeout = process.env.PRISMA_TX_TIMEOUT_MS
  if (rawTimeout == null || rawTimeout === '') {
    return undefined
  }

  const parsedTimeout = Number(rawTimeout)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
    console.warn('[settlementAdjustment] Ignoring invalid PRISMA_TX_TIMEOUT_MS value', {
      rawTimeout,
    })
    return undefined
  }

  return parsedTimeout
})()

const prismaTxOptions = prismaTxTimeoutMs ? { timeout: prismaTxTimeoutMs } : undefined

export interface SettlementAdjustmentJobParams {
  subMerchantId: string
  settlementStatus: string
  start: string | Date
  end: string | Date
  feeConfig?: FeeConfig
  settlementTime?: string | Date | null
}

export interface SettlementAdjustmentProgress {
  processed: number
  total: number
}

export interface SettlementAdjustmentSummary {
  totalOrders: number
  totalTransactions: number
  updatedOrderIds: string[]
  updatedTransactionIds: string[]
  startBoundary: Date
  endBoundary: Date
}

export interface SettlementAdjustmentResult {
  updatedOrderIds: string[]
  updatedTransactionIds: string[]
}

type OrderRecord = {
  id: string
  subMerchantId: string | null
  amount: number
  fee3rdParty: number | null
  feeLauncx: number | null
}

type TransactionRecord = {
  id: string
  subMerchantId: string | null
  amount: number | null
  settlementAmount: number | null
}

type AdjustmentRecord =
  | { type: 'order'; data: OrderRecord }
  | { type: 'transaction'; data: TransactionRecord }

type RunOptions = {
  onProgress?: (progress: SettlementAdjustmentProgress) => void
}

type AdjustmentContext = {
  settlementStatus: string
  settlementTime?: string | Date | null
  feeConfig?: FeeConfig
  targetSubMerchantId?: string
}

function resolveBoundary(value: string | Date, boundary: 'start' | 'end') {
  const m = moment.tz(value, JAKARTA_TZ)
  if (!m.isValid()) {
    throw new Error(`Invalid date provided for ${boundary}`)
  }
  return boundary === 'start' ? m.startOf('day').toDate() : m.endOf('day').toDate()
}

function resolveFeePercent(
  feeConfig: FeeConfig | undefined,
  id: string,
  fallbackFee?: number | null,
  baseAmount?: number
) {
  if (typeof feeConfig === 'number') {
    return feeConfig
  }
  if (feeConfig && typeof feeConfig === 'object') {
    const val = feeConfig[id]
    if (typeof val === 'number') {
      return val
    }
  }
  if (fallbackFee != null && baseAmount) {
    const pct = (fallbackFee / baseAmount) * 100
    return Number.isFinite(pct) ? pct : 0
  }
  return 0
}

async function applyBatchAdjustments(
  records: AdjustmentRecord[],
  context: AdjustmentContext,
  options: RunOptions,
  total: number
): Promise<SettlementAdjustmentResult> {
  const updates: { id: string; type: AdjustmentRecord['type'] }[] = []
  const settlementDate = context.settlementTime ? new Date(context.settlementTime) : null
  const isFinalSettlement = ['SETTLED', 'DONE', 'SUCCESS', 'COMPLETED'].includes(context.settlementStatus)
  const notifyProgress = (() => {
    let processed = 0
    return () => {
      processed += 1
      if (total > 0) {
        options.onProgress?.({ processed, total })
      }
    }
  })()

  const batchSize = 200
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const batchUpdates = await prisma.$transaction(async tx => {
      const localUpdates: { id: string; type: AdjustmentRecord['type'] }[] = []
      for (const record of batch) {
        if (record.type === 'order') {
          const order = record.data
          const baseAmount = Number(order.amount ?? 0) - Number(order.fee3rdParty ?? 0)
          const feePercent = resolveFeePercent(context.feeConfig, order.id, order.feeLauncx, baseAmount)
          const { fee, settlement } = computeSettlement(baseAmount, { percent: feePercent })
          const where: Record<string, unknown> = {
            id: order.id,
            status: 'PAID',
          }
          if (context.targetSubMerchantId) {
            where.subMerchantId = context.targetSubMerchantId
          } else if (order.subMerchantId) {
            where.subMerchantId = order.subMerchantId
          }

          const result = await tx.order.updateMany({
            where,
            data: {
              settlementStatus: context.settlementStatus,
              ...(settlementDate ? { settlementTime: settlementDate } : {}),
              feeLauncx: fee,
              settlementAmount: settlement,
            },
          })

          if (result.count > 0) {
            if (isFinalSettlement) {
              const settleWhere: Record<string, unknown> = { id: order.id }
              if (context.targetSubMerchantId) {
                settleWhere.subMerchantId = context.targetSubMerchantId
              } else if (order.subMerchantId) {
                settleWhere.subMerchantId = order.subMerchantId
              }
              await tx.order.updateMany({
                where: settleWhere,
                data: { status: 'SETTLED', pendingAmount: null },
              })
            }
            localUpdates.push({ id: order.id, type: 'order' })
          }
        } else {
          const trx = record.data
          const baseAmount = trx.settlementAmount ?? trx.amount ?? 0
          const feePercent = resolveFeePercent(context.feeConfig, trx.id)
          const { settlement } = computeSettlement(baseAmount, { percent: feePercent })
          await tx.transaction_request.update({
            where: { id: trx.id },
            data: {
              ...(settlementDate ? { settlementAt: settlementDate } : {}),
              settlementAmount: settlement,
            },
          })
          localUpdates.push({ id: trx.id, type: 'transaction' })
        }
        notifyProgress()
      }
      return localUpdates
    }, prismaTxOptions)
    updates.push(...batchUpdates)
  }

  if (total === 0) {
    options.onProgress?.({ processed: 0, total: 0 })
  }

  return {
    updatedOrderIds: updates.filter(u => u.type === 'order').map(u => u.id),
    updatedTransactionIds: updates.filter(u => u.type === 'transaction').map(u => u.id),
  }
}

export async function applySettlementAdjustments(
  source: { orders: OrderRecord[]; transactions: TransactionRecord[] },
  context: AdjustmentContext,
  options: RunOptions = {}
): Promise<SettlementAdjustmentResult> {
  const records: AdjustmentRecord[] = [
    ...source.orders.map(order => ({ type: 'order' as const, data: order })),
    ...source.transactions.map(transaction => ({ type: 'transaction' as const, data: transaction })),
  ]
  return applyBatchAdjustments(records, context, options, records.length)
}

export async function runSettlementAdjustmentJob(
  params: SettlementAdjustmentJobParams,
  options: RunOptions = {}
): Promise<SettlementAdjustmentSummary> {
  const { subMerchantId, settlementStatus, feeConfig, settlementTime } = params
  if (!subMerchantId) {
    throw new Error('subMerchantId is required')
  }
  if (!settlementStatus) {
    throw new Error('settlementStatus is required')
  }

  const startBoundary = resolveBoundary(params.start, 'start')
  const endBoundary = resolveBoundary(params.end, 'end')

  const [orders, transactions] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: 'PAID',
        subMerchantId,
        createdAt: {
          gte: startBoundary,
          lte: endBoundary,
        },
      },
      select: {
        id: true,
        amount: true,
        fee3rdParty: true,
        feeLauncx: true,
        subMerchantId: true,
      },
    }),
    prisma.transaction_request.findMany({
      where: {
        status: 'SUCCESS',
        subMerchantId,
        createdAt: {
          gte: startBoundary,
          lte: endBoundary,
        },
      },
      select: {
        id: true,
        amount: true,
        settlementAmount: true,
        subMerchantId: true,
      },
    }),
  ])

  const result = await applyBatchAdjustments(
    [
      ...orders.map(order => ({ type: 'order' as const, data: order })),
      ...transactions.map(transaction => ({ type: 'transaction' as const, data: transaction })),
    ],
    { settlementStatus, feeConfig, settlementTime, targetSubMerchantId: subMerchantId },
    options,
    orders.length + transactions.length
  )

  return {
    totalOrders: orders.length,
    totalTransactions: transactions.length,
    updatedOrderIds: result.updatedOrderIds,
    updatedTransactionIds: result.updatedTransactionIds,
    startBoundary,
    endBoundary,
  }
}
