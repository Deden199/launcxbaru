import moment from 'moment-timezone'

import { prisma } from '../core/prisma'
import { ORDER_STATUS, LOAN_SETTLED_METADATA_REASON } from '../types/orderStatus'
import { logAdminAction } from '../util/adminLog'
import { emitOrderEvent } from '../util/orderEvents'
import { wibTimestamp } from '../util/time'

const DEFAULT_LOAN_CHUNK_SIZE = 25
const configuredLoanChunkSize = Number(process.env.LOAN_CREATE_MANY_CHUNK_SIZE)
const LOAN_CREATE_MANY_CHUNK_SIZE =
  Number.isFinite(configuredLoanChunkSize) && configuredLoanChunkSize >= 1
    ? Math.floor(configuredLoanChunkSize)
    : DEFAULT_LOAN_CHUNK_SIZE

const DEFAULT_LOAN_FETCH_BATCH_SIZE = 100
const configuredLoanFetchBatchSize = Number(process.env.LOAN_FETCH_BATCH_SIZE)
const LOAN_FETCH_BATCH_SIZE =
  Number.isFinite(configuredLoanFetchBatchSize) && configuredLoanFetchBatchSize >= 1
    ? Math.floor(configuredLoanFetchBatchSize)
    : DEFAULT_LOAN_FETCH_BATCH_SIZE

export const toStartOfDayWib = (value: string) => {
  const date = moment.tz(value, 'Asia/Jakarta')
  if (!date.isValid()) {
    throw new Error('Invalid startDate')
  }
  return date.startOf('day').toDate()
}

export const toEndOfDayWib = (value: string) => {
  const date = moment.tz(value, 'Asia/Jakarta')
  if (!date.isValid()) {
    throw new Error('Invalid endDate')
  }
  return date.endOf('day').toDate()
}

export type MarkSettledSummary = {
  ok: string[]
  fail: string[]
  errors: { orderId: string; message: string }[]
}

export type LoanSettlementEventPayload = {
  orderId: string
  previousStatus: string
  adminId?: string
  markedAt: string
  note?: string
}

export type OrderForLoanSettlement = {
  id: string
  status: string
  pendingAmount: number | null | undefined
  settlementAmount: number | null | undefined
  settlementStatus: string | null | undefined
  metadata: unknown
  subMerchantId: string | null | undefined
  loanedAt: Date | null
  createdAt: Date
}

export type LoanSettlementUpdate = {
  id: string
  subMerchantId?: string | null
  metadata: Record<string, any>
  pendingAmount: number | null | undefined
}

export function normalizeMetadata(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, any>) }
  }
  return {}
}

export async function applyLoanSettlementUpdates({
  updates,
  summary,
  adminId,
  note,
  now,
  markedAtIso,
}: {
  updates: LoanSettlementUpdate[]
  summary: MarkSettledSummary
  adminId?: string
  note?: string
  now: Date
  markedAtIso: string
}): Promise<LoanSettlementEventPayload[]> {
  if (updates.length === 0) {
    return []
  }

  const configuredTimeout = Number(process.env.LOAN_TRANSACTION_TIMEOUT)
  const transactionTimeout =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 20000

  const events: LoanSettlementEventPayload[] = []
  const chunkSize = Math.max(1, LOAN_CREATE_MANY_CHUNK_SIZE)

  for (let start = 0; start < updates.length; start += chunkSize) {
    const chunk = updates.slice(start, start + chunkSize)

    await prisma.$transaction(
      async tx => {
        for (const update of chunk) {
          try {
            const result = await tx.order.updateMany({
              where: { id: update.id, status: ORDER_STATUS.PAID },
              data: {
                status: ORDER_STATUS.LN_SETTLED,
                pendingAmount: null,
                settlementStatus: null,
                loanedAt: now,
                metadata: update.metadata,
              },
            })

            if (result.count === 0) {
              if (!summary.fail.includes(update.id)) {
                summary.fail.push(update.id)
              }
              summary.errors.push({
                orderId: update.id,
                message: 'Order status changed before loan settlement could be applied',
              })
              continue
            }

            if (!summary.ok.includes(update.id)) {
              summary.ok.push(update.id)
            }

            const amount = Number(update.pendingAmount ?? 0)
            if (amount > 0 && update.subMerchantId) {
              await tx.loanEntry.upsert({
                where: { orderId: update.id },
                create: {
                  orderId: update.id,
                  subMerchantId: update.subMerchantId,
                  amount,
                  metadata: {
                    reason: LOAN_SETTLED_METADATA_REASON,
                    markedAt: markedAtIso,
                    ...(adminId ? { markedBy: adminId } : {}),
                    ...(note ? { note } : {}),
                  },
                },
                update: {
                  amount,
                  metadata: {
                    reason: LOAN_SETTLED_METADATA_REASON,
                    markedAt: markedAtIso,
                    ...(adminId ? { markedBy: adminId } : {}),
                    ...(note ? { note } : {}),
                  },
                },
              })
            }

            events.push({
              orderId: update.id,
              previousStatus: ORDER_STATUS.PAID,
              adminId,
              markedAt: markedAtIso,
              note,
            })
          } catch (error: any) {
            if (!summary.fail.includes(update.id)) {
              summary.fail.push(update.id)
            }
            const message =
              error instanceof Error && error.message
                ? error.message
                : 'Failed to mark order as loan-settled'
            summary.errors.push({ orderId: update.id, message })
          }
        }
      },
      { timeout: transactionTimeout },
    )
  }

  return events
}

export async function runLoanSettlementByRange({
  subMerchantId,
  startDate,
  endDate,
  note,
  adminId,
}: {
  subMerchantId: string
  startDate: string
  endDate: string
  note?: string
  adminId?: string
}): Promise<MarkSettledSummary> {
  const trimmedNote = note?.trim() ? note.trim() : undefined
  const start = toStartOfDayWib(startDate)
  const end = toEndOfDayWib(endDate)

  const summary: MarkSettledSummary = { ok: [], fail: [], errors: [] }
  const now = wibTimestamp()
  const markedAtIso = now.toISOString()
  const batchSize = Math.max(1, LOAN_FETCH_BATCH_SIZE)

  const allOrderIds: string[] = []

  let cursor: { createdAt: Date; id: string } | null = null
  while (true) {
    const orders = (await prisma.order.findMany({
      where: {
        subMerchantId,
        status: ORDER_STATUS.PAID,
        createdAt: {
          gte: start,
          lte: end,
        },
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  id: { gt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        status: true,
        pendingAmount: true,
        settlementAmount: true,
        settlementStatus: true,
        metadata: true,
        subMerchantId: true,
        loanedAt: true,
        createdAt: true,
      },
      take: batchSize,
    })) as OrderForLoanSettlement[]

    if (orders.length === 0) {
      cursor = null
      break
    }

    const updates: LoanSettlementUpdate[] = []
    for (const order of orders) {
      allOrderIds.push(order.id)

      const metadata = normalizeMetadata(order.metadata)
      const auditEntry = {
        reason: LOAN_SETTLED_METADATA_REASON,
        previousStatus: ORDER_STATUS.PAID,
        markedBy: adminId ?? 'unknown',
        markedAt: markedAtIso,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      }

      const historyKey = 'loanSettlementHistory'
      const history = Array.isArray(metadata[historyKey])
        ? [...metadata[historyKey], auditEntry]
        : [auditEntry]

      metadata[historyKey] = history
      metadata.lastLoanSettlement = auditEntry

      updates.push({
        id: order.id,
        subMerchantId: order.subMerchantId,
        metadata,
        pendingAmount: order.pendingAmount,
      })
    }

    const events = await applyLoanSettlementUpdates({
      updates,
      summary,
      adminId,
      note: trimmedNote,
      now,
      markedAtIso,
    })

    for (const event of events) {
      emitOrderEvent('order.loan_settled', event)
    }

    if (orders.length < batchSize) {
      cursor = null
      break
    }

    const lastOrder = orders[orders.length - 1]
    cursor = { createdAt: lastOrder.createdAt, id: lastOrder.id }
  }

  if (adminId && allOrderIds.length > 0) {
    await logAdminAction(adminId, 'loanMarkSettled', undefined, {
      orderIds: allOrderIds,
      ok: summary.ok,
      fail: summary.fail,
      note: trimmedNote,
    })
  }

  return summary
}

