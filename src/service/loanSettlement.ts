import { Prisma } from '@prisma/client'
import moment from 'moment-timezone'

import { prisma } from '../core/prisma'
import { ORDER_STATUS, LOAN_SETTLED_METADATA_REASON } from '../types/orderStatus'
import { logAdminAction } from '../util/adminLog'
import { emitOrderEvent } from '../util/orderEvents'
import { wibTimestamp } from '../util/time'
import { createCsvExport, type CsvExportFile } from '../util/export'

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

export const LOAN_ADJUSTABLE_STATUSES = [
  ORDER_STATUS.PAID,
  ORDER_STATUS.SUCCESS,
  ORDER_STATUS.DONE,
  ORDER_STATUS.SETTLED,
] as const

export type LoanAdjustableStatus = (typeof LOAN_ADJUSTABLE_STATUSES)[number]

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
  loanAmount?: number | null
  loanSettlementJobId?: string
  loanFlagged?: boolean
}

export type OrderForLoanSettlement = {
  id: string
  partnerClientId?: string | null
  status: string
  pendingAmount: number | null | undefined
  settlementAmount: number | null | undefined
  settlementStatus: string | null | undefined
  settlementTime: Date | null | undefined
  metadata: unknown
  subMerchantId: string | null | undefined
  isLoan: boolean
  loanAmount: number | null | undefined
  loanAt: Date | null
  loanBy: string | null | undefined
  loanedAt: Date | null
  createdAt: Date
  loanEntry?: {
    id: string | null
    subMerchantId: string | null
    amount: number | null
    metadata: unknown
  } | null
}

export type LoanSettlementLoanEntrySnapshot = {
  id: string | null
  subMerchantId: string | null
  amount: number | null
  metadata?: Record<string, any> | null
}

export type LoanSettlementUpdate = {
  id: string
  partnerClientId?: string | null
  subMerchantId?: string | null
  metadata: Record<string, any>
  pendingAmount: number | null | undefined
  originalStatus: string
  settlementAmount: number | null | undefined
  previousLoanEntry: LoanSettlementLoanEntrySnapshot | null
}

type LoanSettlementRevertUpdate = {
  id: string
  metadata: Record<string, any>
  status: string
  pendingAmount: number | null
  settlementStatus: string | null
  settlementAmount: number | null
  settlementTime: Date | null
  isLoan: boolean
  loanAmount: number | null
  loanAt: Date | null
  loanBy: string | null
  loanedAt: Date | null
  subMerchantId?: string | null
  loanEntry?: {
    id: string | null
    subMerchantId: string | null
    amount: number | null
    metadata?: Record<string, any> | null
  } | null
  revertOf?: string
}

export type LoanSettlementSnapshot = {
  status: string
  pendingAmount: number | null
  settlementStatus: string | null
  settlementAmount: number | null
  settlementTime: string | null
  isLoan: boolean
  loanAmount: number | null
  loanAt: string | null
  loanBy: string | null
  loanedAt: string | null
  loanEntry?: LoanSettlementLoanEntrySnapshot | null
  previousStatus: string
  previousPendingAmount: number | null
  previousSettlementStatus: string | null
  previousSettlementAmount: number | null
  previousSettlementTime: string | null
  previousIsLoan: boolean
  previousLoanAmount: number | null
  previousLoanAt: string | null
  previousLoanBy: string | null
  previousLoanEntry?: LoanSettlementLoanEntrySnapshot | null
}

export type LoanSettlementHistoryEntry = {
  reason: string
  previousStatus: string
  markedBy: string
  markedAt: string
  note?: string
  snapshot: LoanSettlementSnapshot
  [key: string]: any
}

export type LoanSettlementRevertEventPayload = {
  orderId: string
  previousStatus: string
  restoredStatus: string
  adminId?: string
  revertedAt: string
  note?: string
  revertOf?: string
}

export type LoanSettlementRevertSummary = MarkSettledSummary & {
  events: LoanSettlementRevertEventPayload[]
  exportFile?: CsvExportFile | null
}

export function createLoanEntrySnapshot(
  loanEntry: OrderForLoanSettlement['loanEntry'],
): LoanSettlementLoanEntrySnapshot | null {
  if (!loanEntry) {
    return null
  }

  const amount =
    loanEntry.amount == null || Number.isNaN(Number(loanEntry.amount))
      ? null
      : Number(loanEntry.amount)

  const metadata =
    loanEntry.metadata && typeof loanEntry.metadata === 'object'
      ? { ...(loanEntry.metadata as Record<string, any>) }
      : null

  return {
    id: loanEntry.id ?? null,
    subMerchantId: loanEntry.subMerchantId ?? null,
    amount,
    metadata,
  }
}

export function createLoanSettlementSnapshot(order: OrderForLoanSettlement): LoanSettlementSnapshot {
  const pendingAmount =
    order.pendingAmount == null || Number.isNaN(Number(order.pendingAmount))
      ? null
      : Number(order.pendingAmount)
  const settlementAmount =
    order.settlementAmount == null || Number.isNaN(Number(order.settlementAmount))
      ? null
      : Number(order.settlementAmount)
  const settlementTime = order.settlementTime ? order.settlementTime.toISOString() : null
  const isLoan = Boolean(order.isLoan)
  const loanAmount =
    order.loanAmount == null || Number.isNaN(Number(order.loanAmount))
      ? null
      : Number(order.loanAmount)
  const loanAt = order.loanAt ? order.loanAt.toISOString() : null
  const loanBy = typeof order.loanBy === 'string' ? order.loanBy : null
  const loanedAt = order.loanedAt ? order.loanedAt.toISOString() : null
  const loanEntrySnapshot = createLoanEntrySnapshot(order.loanEntry)

  return {
    status: order.status,
    pendingAmount,
    settlementStatus: order.settlementStatus ?? null,
    settlementAmount,
    settlementTime,
    isLoan,
    loanAmount,
    loanAt,
    loanBy,
    loanedAt,
    loanEntry: loanEntrySnapshot,
    previousStatus: order.status,
    previousPendingAmount: pendingAmount,
    previousSettlementStatus: order.settlementStatus ?? null,
    previousSettlementAmount: settlementAmount,
    previousSettlementTime: settlementTime,
    previousIsLoan: isLoan,
    previousLoanAmount: loanAmount,
    previousLoanAt: loanAt,
    previousLoanBy: loanBy,
    previousLoanEntry: loanEntrySnapshot,
  }
}

function createPreviousLoanEntryMetadata(
  previous: LoanSettlementLoanEntrySnapshot | null,
): Record<string, any> | null {
  if (!previous) {
    return null
  }

  const metadata = previous.metadata && typeof previous.metadata === 'object' ? previous.metadata : null

  const snapshot: Record<string, any> = {
    id: previous.id,
    subMerchantId: previous.subMerchantId,
    amount: previous.amount,
    metadata,
  }

  if (previous.amount != null) {
    snapshot.originalAmount = previous.amount
  }

  if (metadata) {
    const markedAt = metadata.markedAt
    const reason = metadata.reason
    const markedBy = metadata.markedBy

    if (typeof markedAt === 'string') {
      snapshot.markedAt = markedAt
    }

    if (typeof reason === 'string') {
      snapshot.reason = reason
    }

    if (typeof markedBy === 'string') {
      snapshot.markedBy = markedBy
    }
  }

  return snapshot
}

export function createLoanSettlementAuditEntry({
  order,
  adminId,
  markedAtIso,
  note,
}: {
  order: OrderForLoanSettlement
  adminId?: string
  markedAtIso: string
  note?: string
}): LoanSettlementHistoryEntry {
  const snapshot = createLoanSettlementSnapshot(order)
  const entry: LoanSettlementHistoryEntry = {
    reason: LOAN_SETTLED_METADATA_REASON,
    previousStatus: order.status,
    markedBy: adminId ?? 'unknown',
    markedAt: markedAtIso,
    snapshot,
  }

  if (note) {
    entry.note = note
  }

  return entry
}

export function normalizeMetadata(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, any>) }
  }
  return {}
}

const ORDER_REVERSAL_METADATA_KEYS = [
  'reversal',
  'previousStatus',
  'previousSettlementTime',
  'previousSettlementAmount',
  'reason',
  'reversedAt',
  'reversedBy',
] as const

const LOAN_ENTRY_REVERSAL_METADATA_KEYS = ['reversal', 'lastAction'] as const

const PRISMA_JSON_NULL = (Prisma as unknown as { JsonNull?: unknown }).JsonNull

type SanitizedMetadataResult = {
  sanitized: unknown
  changed: boolean
}

const sanitizeObjectMetadata = (
  metadata: unknown,
  keysToRemove: readonly string[],
): SanitizedMetadataResult => {
  if (metadata === null || metadata === undefined) {
    return { sanitized: metadata ?? null, changed: false }
  }

  if (PRISMA_JSON_NULL !== undefined && metadata === PRISMA_JSON_NULL) {
    return { sanitized: PRISMA_JSON_NULL, changed: false }
  }

  if (Array.isArray(metadata) || typeof metadata !== 'object') {
    return { sanitized: metadata, changed: false }
  }

  const clone = { ...(metadata as Record<string, unknown>) }
  let changed = false

  for (const key of keysToRemove) {
    if (key in clone) {
      delete clone[key]
      changed = true
    }
  }

  return { sanitized: clone, changed }
}

export type CleanupReversalMetadataOptions = {
  startDate: string
  endDate: string
  subMerchantId?: string
  dryRun?: boolean
}

export type CleanupReversalMetadataResult = {
  total: number
  cleaned: number
  failed: { orderId: string; message?: string }[]
  updatedOrderIds: string[]
  dryRun: boolean
}

type OrderWithReversalMetadata = {
  id: string
  metadata: unknown
  loanedAt: Date | null
  loanEntry: {
    id: string
    metadata: unknown
  } | null
}

const buildCleanupReversalWhere = ({
  startDate,
  endDate,
  subMerchantId,
}: CleanupReversalMetadataOptions) => {
  const start = toStartOfDayWib(startDate)
  const end = toEndOfDayWib(endDate)

  if (start.getTime() > end.getTime()) {
    throw new Error('startDate must be before or equal to endDate')
  }

  const where: Record<string, unknown> = {
    loanedAt: {
      gte: start,
      lte: end,
    },
    metadata: {
      path: ['reversal'],
      not: (PRISMA_JSON_NULL ?? null) as unknown,
    },
  }

  if (subMerchantId) {
    where.subMerchantId = subMerchantId
  }

  return { where }
}

export async function cleanupReversalMetadata(
  options: CleanupReversalMetadataOptions,
): Promise<CleanupReversalMetadataResult> {
  const dryRun = options.dryRun ?? false
  const { where } = buildCleanupReversalWhere(options)

  const orders = (await prisma.order.findMany({
    where,
    select: {
      id: true,
      metadata: true,
      loanedAt: true,
      loanEntry: {
        select: {
          id: true,
          metadata: true,
        },
      },
    },
  })) as OrderWithReversalMetadata[]

  const failed: { orderId: string; message?: string }[] = []
  const updatedOrderIds: string[] = []

  for (const order of orders) {
    try {
      const { sanitized: sanitizedOrderMetadata } = sanitizeObjectMetadata(
        order.metadata,
        ORDER_REVERSAL_METADATA_KEYS,
      )

      if (!dryRun) {
        await prisma.order.update({
          where: { id: order.id },
          data: { metadata: sanitizedOrderMetadata as unknown, loanedAt: null },
        })
      }

      if (order.loanEntry && order.loanEntry.id) {
        const { sanitized: sanitizedLoanEntryMetadata, changed } = sanitizeObjectMetadata(
          order.loanEntry.metadata,
          LOAN_ENTRY_REVERSAL_METADATA_KEYS,
        )

        if (changed && !dryRun) {
          await prisma.loanEntry.update({
            where: { id: order.loanEntry.id },
            data: { metadata: sanitizedLoanEntryMetadata as unknown },
          })
        }
      }

      updatedOrderIds.push(order.id)
    } catch (err) {
      failed.push({ orderId: order.id, message: err instanceof Error ? err.message : undefined })
    }
  }

  return {
    total: orders.length,
    cleaned: updatedOrderIds.length,
    failed,
    updatedOrderIds,
    dryRun,
  }
}

export async function applyLoanSettlementUpdates({
  updates,
  summary,
  adminId,
  note,
  now,
  markedAtIso,
  loanSettlementJobId,
}: {
  updates: LoanSettlementUpdate[]
  summary: MarkSettledSummary
  adminId?: string
  note?: string
  now: Date
  markedAtIso: string
  loanSettlementJobId?: string
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
          let normalizedAmount: number | null = null
          let subBalanceAdjusted = false
          let partnerBalanceAdjusted = false
          const addFailure = (message: string) => {
            if (!summary.fail.includes(update.id)) {
              summary.fail.push(update.id)
            }
            summary.errors.push({ orderId: update.id, message })
          }

          try {
            let resolvedAmount = Number(update.pendingAmount ?? 0)
            if ((!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) && update.settlementAmount != null) {
              const fallback = Number(update.settlementAmount)
              resolvedAmount = Number.isFinite(fallback) ? fallback : 0
            }
            normalizedAmount =
              Number.isFinite(resolvedAmount) && resolvedAmount > 0 ? Number(resolvedAmount) : null

            const shouldAdjustBalance = normalizedAmount != null && normalizedAmount > 0

            if (shouldAdjustBalance) {
              if (!update.subMerchantId) {
                addFailure('Order is missing sub-merchant balance for loan adjustment')
                continue
              }

              const subBalanceResult = await tx.subMerchantBalance.updateMany({
                where: {
                  subMerchantId: update.subMerchantId,
                  availableBalance: {
                    gte: normalizedAmount!,
                  },
                },
                data: {
                  availableBalance: {
                    decrement: normalizedAmount!,
                  },
                },
              })

              if (subBalanceResult.count === 0) {
                addFailure('Saldo sub-merchant tidak mencukupi untuk penyesuaian pinjaman')
                continue
              }

              subBalanceAdjusted = true

              if (update.partnerClientId) {
                const partnerBalanceResult = await tx.partnerClient.updateMany({
                  where: {
                    id: update.partnerClientId,
                    balance: {
                      gte: normalizedAmount!,
                    },
                  },
                  data: {
                    balance: {
                      decrement: normalizedAmount!,
                    },
                  },
                })

                if (partnerBalanceResult.count === 0) {
                  await tx.subMerchantBalance.update({
                    where: { subMerchantId: update.subMerchantId },
                    data: {
                      availableBalance: {
                        increment: normalizedAmount!,
                      },
                    },
                  })
                  subBalanceAdjusted = false
                  addFailure('Saldo partner tidak mencukupi untuk penyesuaian pinjaman')
                  continue
                }

                partnerBalanceAdjusted = true
              }
            }

            const result = await tx.order.updateMany({
              where: { id: update.id, status: update.originalStatus },
              data: {
                status: ORDER_STATUS.LN_SETTLED,
                pendingAmount: null,
                settlementStatus: null,
                settlementTime: null,
                settlementAmount: null,
                isLoan: true,
                loanAmount: normalizedAmount,
                loanAt: now,
                loanBy: adminId ?? null,
                loanedAt: now,
                metadata: update.metadata,
              },
            })

            if (result.count === 0) {
              if (shouldAdjustBalance && normalizedAmount != null) {
                if (subBalanceAdjusted && update.subMerchantId) {
                  await tx.subMerchantBalance.update({
                    where: { subMerchantId: update.subMerchantId },
                    data: {
                      availableBalance: {
                        increment: normalizedAmount,
                      },
                    },
                  })
                  subBalanceAdjusted = false
                }

                if (partnerBalanceAdjusted && update.partnerClientId) {
                  await tx.partnerClient.update({
                    where: { id: update.partnerClientId },
                    data: {
                      balance: {
                        increment: normalizedAmount,
                      },
                    },
                  })
                  partnerBalanceAdjusted = false
                }
              }

              addFailure('Order status changed before loan settlement could be applied')
              continue
            }

            if (!summary.ok.includes(update.id)) {
              summary.ok.push(update.id)
            }

            if (shouldAdjustBalance && update.subMerchantId) {
              const previousLoanEntryMetadata = createPreviousLoanEntryMetadata(update.previousLoanEntry)
              const loanEntryMetadata: Record<string, any> = {
                reason: LOAN_SETTLED_METADATA_REASON,
                markedAt: markedAtIso,
                ...(adminId ? { markedBy: adminId } : {}),
                ...(note ? { note } : {}),
                ...(previousLoanEntryMetadata ? { previousLoanEntry: previousLoanEntryMetadata } : {}),
              }

              await tx.loanEntry.upsert({
                where: { orderId: update.id },
                create: {
                  orderId: update.id,
                  subMerchantId: update.subMerchantId,
                  amount: normalizedAmount!,
                  metadata: loanEntryMetadata,
                },
                update: {
                  amount: normalizedAmount!,
                  metadata: loanEntryMetadata,
                },
              })
            }

            if (loanSettlementJobId) {
              await tx.loanSettlementJob.update({
                where: { id: loanSettlementJobId },
                data: {
                  totalOrder: { increment: 1 },
                  ...(normalizedAmount
                    ? { totalLoanAmount: { increment: normalizedAmount } }
                    : {}),
                },
              })
            }

            events.push({
              orderId: update.id,
              previousStatus: update.originalStatus,
              adminId,
              markedAt: markedAtIso,
              note,
              loanAmount: normalizedAmount,
              loanSettlementJobId,
              loanFlagged: true,
            })
          } catch (error: any) {
            if (normalizedAmount != null && normalizedAmount > 0) {
              if (subBalanceAdjusted && update.subMerchantId) {
                try {
                  await tx.subMerchantBalance.update({
                    where: { subMerchantId: update.subMerchantId },
                    data: {
                      availableBalance: {
                        increment: normalizedAmount,
                      },
                    },
                  })
                } catch {
                  // ignore revert errors but continue logging failure below
                }
              }

              if (partnerBalanceAdjusted && update.partnerClientId) {
                try {
                  await tx.partnerClient.update({
                    where: { id: update.partnerClientId },
                    data: {
                      balance: {
                        increment: normalizedAmount,
                      },
                    },
                  })
                } catch {
                  // ignore revert errors but continue logging failure below
                }
              }
            }

            const message =
              error instanceof Error && error.message
                ? error.message
                : 'Failed to mark order as loan-settled'
            addFailure(message)
          }
        }
      },
      { timeout: transactionTimeout },
    )
  }

  return events
}

async function applyLoanSettlementRevertUpdates({
  updates,
  summary,
  adminId,
  note,
  revertAtIso,
}: {
  updates: LoanSettlementRevertUpdate[]
  summary: LoanSettlementRevertSummary
  adminId?: string
  note?: string
  revertAtIso: string
}): Promise<LoanSettlementRevertEventPayload[]> {
  if (updates.length === 0) {
    return []
  }

  const configuredTimeout = Number(process.env.LOAN_TRANSACTION_TIMEOUT)
  const transactionTimeout =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 20000

  const events: LoanSettlementRevertEventPayload[] = []
  const chunkSize = Math.max(1, LOAN_CREATE_MANY_CHUNK_SIZE)

  for (let start = 0; start < updates.length; start += chunkSize) {
    const chunk = updates.slice(start, start + chunkSize)

    await prisma.$transaction(
      async tx => {
        for (const update of chunk) {
          try {
            const result = await tx.order.updateMany({
              where: { id: update.id, status: ORDER_STATUS.LN_SETTLED },
              data: {
                status: update.status,
                pendingAmount: update.pendingAmount,
                settlementStatus: update.settlementStatus,
                settlementTime: update.settlementTime,
                settlementAmount: update.settlementAmount,
                isLoan: update.isLoan,
                loanAmount: update.loanAmount,
                loanAt: update.loanAt,
                loanBy: update.loanBy,
                loanedAt: update.loanedAt,
                metadata: update.metadata,
              },
            })

            if (result.count === 0) {
              if (!summary.fail.includes(update.id)) {
                summary.fail.push(update.id)
              }
              summary.errors.push({
                orderId: update.id,
                message: 'Order status changed before loan settlement could be reverted',
              })
              continue
            }

            if (!summary.ok.includes(update.id)) {
              summary.ok.push(update.id)
            }

            const amount =
              update.loanEntry?.amount != null && Number.isFinite(Number(update.loanEntry.amount))
                ? Number(update.loanEntry.amount)
                : null
            const resolvedSubMerchantId =
              update.subMerchantId ?? update.loanEntry?.subMerchantId ?? null

            if (amount != null && amount > 0 && resolvedSubMerchantId) {
              await tx.loanEntry.upsert({
                where: { orderId: update.id },
                create: {
                  orderId: update.id,
                  subMerchantId: resolvedSubMerchantId,
                  amount,
                  metadata:
                    update.loanEntry?.metadata && typeof update.loanEntry.metadata === 'object'
                      ? update.loanEntry.metadata
                      : undefined,
                },
                update: {
                  amount,
                  subMerchantId: resolvedSubMerchantId,
                  metadata:
                    update.loanEntry?.metadata && typeof update.loanEntry.metadata === 'object'
                      ? update.loanEntry.metadata
                      : undefined,
                },
              })
            } else {
              await tx.loanEntry.deleteMany({ where: { orderId: update.id } })
            }

            events.push({
              orderId: update.id,
              previousStatus: ORDER_STATUS.LN_SETTLED,
              restoredStatus: update.status,
              adminId,
              revertedAt: revertAtIso,
              note,
              revertOf: update.revertOf,
            })
          } catch (error: any) {
            if (!summary.fail.includes(update.id)) {
              summary.fail.push(update.id)
            }
            const message =
              error instanceof Error && error.message
                ? error.message
                : 'Failed to revert loan settlement'
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
  loanSettlementJobId,
  dryRun,
}: {
  subMerchantId: string
  startDate: string
  endDate: string
  note?: string
  adminId?: string
  loanSettlementJobId?: string
  dryRun?: boolean
}): Promise<MarkSettledSummary> {
  const trimmedNote = note?.trim() ? note.trim() : undefined
  const start = toStartOfDayWib(startDate)
  const end = toEndOfDayWib(endDate)

  const summary: MarkSettledSummary = { ok: [], fail: [], errors: [] }
  const now = wibTimestamp()
  const markedAtIso = now.toISOString()
  const batchSize = Math.max(1, LOAN_FETCH_BATCH_SIZE)
  const isDryRun = Boolean(dryRun)

  const allOrderIds: string[] = []

  let cursor: { createdAt: Date; id: string } | null = null
  while (true) {
    const dateRangeFilter = {
      OR: [
        {
          settlementTime: {
            gte: start,
            lte: end,
          },
        },
        {
          settlementTime: null,
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      ],
    }

    const orders = (await prisma.order.findMany({
      where: {
        subMerchantId,
        status: { in: [...LOAN_ADJUSTABLE_STATUSES] },
        settlementStatus: { in: ['ACTIVE', 'COMPLETED'] },
        isLoan: false,
        ...dateRangeFilter,
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
        partnerClientId: true,
        status: true,
        pendingAmount: true,
        settlementAmount: true,
        settlementStatus: true,
        settlementTime: true,
        metadata: true,
        subMerchantId: true,
        isLoan: true,
        loanAmount: true,
        loanAt: true,
        loanBy: true,
        loanedAt: true,
        createdAt: true,
        loanEntry: {
          select: {
            id: true,
            subMerchantId: true,
            amount: true,
            metadata: true,
          },
        },
      },
      take: batchSize,
    })) as OrderForLoanSettlement[]

    if (orders.length === 0) {
      cursor = null
      break
    }

    const updates: LoanSettlementUpdate[] = []
    let dryRunProcessed = 0
    let dryRunAmount = 0

    for (const order of orders) {
      allOrderIds.push(order.id)

      if (isDryRun) {
        if (!summary.ok.includes(order.id)) {
          summary.ok.push(order.id)
        }

        const resolvedAmount = Number(order.pendingAmount ?? 0)
        let normalizedAmount = Number.isFinite(resolvedAmount) ? resolvedAmount : 0
        if ((!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) && order.settlementAmount != null) {
          const fallback = Number(order.settlementAmount)
          normalizedAmount = Number.isFinite(fallback) ? fallback : 0
        }

        if (normalizedAmount > 0) {
          dryRunAmount += normalizedAmount
        }

        dryRunProcessed += 1
        continue
      }

      const metadata = normalizeMetadata(order.metadata)
      const auditEntry = createLoanSettlementAuditEntry({
        order,
        adminId,
        markedAtIso,
        note: trimmedNote,
      })

      if (loanSettlementJobId) {
        auditEntry.loanSettlementJobId = loanSettlementJobId
      }

      const previousLoanEntry = createLoanEntrySnapshot(order.loanEntry)

      const historyKey = 'loanSettlementHistory'
      const history = Array.isArray(metadata[historyKey])
        ? [...metadata[historyKey], auditEntry]
        : [auditEntry]

      metadata[historyKey] = history
      metadata.lastLoanSettlement = auditEntry
      metadata.loanFlag = true
      metadata.loanFlaggedAt = markedAtIso
      if (loanSettlementJobId) {
        metadata.loanSettlementJobId = loanSettlementJobId
      }

      updates.push({
        id: order.id,
        partnerClientId: order.partnerClientId ?? null,
        subMerchantId: order.subMerchantId,
        metadata,
        pendingAmount: order.pendingAmount,
        originalStatus: order.status,
        settlementAmount: order.settlementAmount,
        previousLoanEntry,
      })
    }

    if (isDryRun) {
      if (loanSettlementJobId && dryRunProcessed > 0) {
        await prisma.loanSettlementJob.update({
          where: { id: loanSettlementJobId },
          data: {
            totalOrder: { increment: dryRunProcessed },
            ...(dryRunAmount > 0 ? { totalLoanAmount: { increment: dryRunAmount } } : {}),
          },
        })
      }
    } else {
      const events = await applyLoanSettlementUpdates({
        updates,
        summary,
        adminId,
        note: trimmedNote,
        now,
        markedAtIso,
        loanSettlementJobId,
      })

      for (const event of events) {
        emitOrderEvent('order.loan_settled', event)
      }
    }

    if (orders.length < batchSize) {
      cursor = null
      break
    }

    const lastOrder = orders[orders.length - 1]
    cursor = { createdAt: lastOrder.createdAt, id: lastOrder.id }
  }

  if (!isDryRun && adminId && allOrderIds.length > 0) {
    await logAdminAction(adminId, 'loanMarkSettled', undefined, {
      orderIds: allOrderIds,
      ok: summary.ok,
      fail: summary.fail,
      note: trimmedNote,
    })
  }

  return summary
}

type LoanSettlementRevertExportRow = {
  orderId: string
  subMerchantId: string | null | undefined
  revertStatus: string
  revertPendingAmount: number | null
  revertSettlementStatus: string | null
  revertSettlementAmount: number | null
  revertSettlementTime: Date | null
  revertLoanedAt: Date | null
  revertLoanAmount: number | null
  revertLoanAt: Date | null
  revertLoanBy: string | null
  originalMarkedAt?: string
  originalMarkedBy?: string
  originalNote?: string
}

const parseNullableNumber = (value: any): number | null => {
  if (value === null || value === undefined) {
    return null
  }
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const parseOptionalDate = (value: any): Date | null => {
  if (!value || typeof value !== 'string') {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const parseOptionalString = (value: any): string | null => {
  return typeof value === 'string' ? value : null
}

const parseSnapshotLoanEntry = (value: any): LoanSettlementLoanEntrySnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, any>
  const amount = parseNullableNumber(record.amount)
  const metadata =
    record.metadata && typeof record.metadata === 'object'
      ? { ...(record.metadata as Record<string, any>) }
      : null

  const id = typeof record.id === 'string' ? record.id : null
  const subMerchantId = typeof record.subMerchantId === 'string' ? record.subMerchantId : null

  return {
    id,
    subMerchantId,
    amount,
    metadata,
  }
}

const cloneHistoryEntry = (value: any): Record<string, any> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return { ...(value as Record<string, any>) }
}

export async function revertLoanSettlementsByRange({
  subMerchantId,
  startDate,
  endDate,
  note,
  adminId,
  orderIds,
  exportOnly,
}: {
  subMerchantId: string
  startDate: string
  endDate: string
  note?: string
  adminId?: string
  orderIds?: string[]
  exportOnly?: boolean
}): Promise<LoanSettlementRevertSummary> {
  const trimmedNote = note?.trim() ? note.trim() : undefined
  const start = toStartOfDayWib(startDate)
  const end = toEndOfDayWib(endDate)

  const summary: LoanSettlementRevertSummary = {
    ok: [],
    fail: [],
    errors: [],
    events: [],
    exportFile: null,
  }

  const now = wibTimestamp()
  const revertAtIso = now.toISOString()
  const batchSize = Math.max(1, LOAN_FETCH_BATCH_SIZE)
  const allOrderIds: string[] = []
  const exportRows: LoanSettlementRevertExportRow[] = []
  const normalizedOrderIds = orderIds && orderIds.length > 0 ? new Set(orderIds) : null

  let cursor: { createdAt: Date; id: string } | null = null
  const updates: LoanSettlementRevertUpdate[] = []

  while (true) {
    const orders = (await prisma.order.findMany({
      where: {
        subMerchantId,
        status: ORDER_STATUS.LN_SETTLED,
        ...(normalizedOrderIds ? { id: { in: Array.from(normalizedOrderIds) } } : {}),
        AND: [
          // Allow LN_SETTLED orders whose settlement timestamp falls outside the
          // range to still be considered when they were created within the
          // selected admin date filter.
          {
            OR: [
              {
                loanedAt: {
                  gte: start,
                  lte: end,
                },
              },
              {
                createdAt: {
                  gte: start,
                  lte: end,
                },
              },
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { gt: cursor.createdAt } },
                    {
                      createdAt: cursor.createdAt,
                      id: { gt: cursor.id },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [
        // Align the pagination cursor with the same column used for filtering
        // so the date range in the admin UI matches the backend results.
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        status: true,
        pendingAmount: true,
        settlementAmount: true,
        settlementStatus: true,
        settlementTime: true,
        metadata: true,
        subMerchantId: true,
        isLoan: true,
        loanAmount: true,
        loanAt: true,
        loanBy: true,
        loanedAt: true,
        createdAt: true,
        loanEntry: {
          select: {
            id: true,
            subMerchantId: true,
            amount: true,
            metadata: true,
          },
        },
      },
      take: batchSize,
    })) as OrderForLoanSettlement[]

    if (orders.length === 0) {
      cursor = null
      break
    }

    for (const order of orders) {
      allOrderIds.push(order.id)

      const metadata = normalizeMetadata(order.metadata)
      const historyKey = 'loanSettlementHistory'
      const history = Array.isArray(metadata[historyKey])
        ? (metadata[historyKey] as any[]).map(item => cloneHistoryEntry(item) ?? item)
        : []

      let targetIndex = -1
      let targetEntry: Record<string, any> | null = null
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const entry = cloneHistoryEntry(history[i])
        if (!entry) {
          continue
        }
        if (entry.reason === LOAN_SETTLED_METADATA_REASON && entry.snapshot) {
          targetIndex = i
          targetEntry = entry
          break
        }
      }

      if (!targetEntry || targetIndex < 0) {
        summary.fail.push(order.id)
        summary.errors.push({
          orderId: order.id,
          message: 'Loan settlement history snapshot is missing and cannot be reverted',
        })
        continue
      }

      const snapshotValue = cloneHistoryEntry(targetEntry.snapshot)
      if (!snapshotValue) {
        summary.fail.push(order.id)
        summary.errors.push({
          orderId: order.id,
          message: 'Loan settlement snapshot is invalid',
        })
        continue
      }

      const revertStatus =
        typeof snapshotValue.previousStatus === 'string'
          ? snapshotValue.previousStatus
          : typeof snapshotValue.status === 'string'
          ? snapshotValue.status
          : typeof targetEntry.previousStatus === 'string'
          ? targetEntry.previousStatus
          : ORDER_STATUS.SUCCESS

      const revertPendingAmount = parseNullableNumber(
        snapshotValue.previousPendingAmount ?? snapshotValue.pendingAmount,
      )
      const revertSettlementStatus =
        typeof snapshotValue.previousSettlementStatus === 'string'
          ? snapshotValue.previousSettlementStatus
          : typeof snapshotValue.settlementStatus === 'string'
          ? snapshotValue.settlementStatus
          : null
      const revertSettlementAmount = parseNullableNumber(
        snapshotValue.previousSettlementAmount ?? snapshotValue.settlementAmount,
      )
      const revertSettlementTime = parseOptionalDate(
        snapshotValue.previousSettlementTime ?? snapshotValue.settlementTime,
      )
      const revertLoanedAt = parseOptionalDate(snapshotValue.loanedAt) ?? null
      const revertIsLoan =
        typeof snapshotValue.previousIsLoan === 'boolean'
          ? snapshotValue.previousIsLoan
          : typeof snapshotValue.isLoan === 'boolean'
          ? snapshotValue.isLoan
          : false
      const revertLoanAmount = parseNullableNumber(
        snapshotValue.previousLoanAmount ?? snapshotValue.loanAmount,
      )
      const revertLoanAt = parseOptionalDate(snapshotValue.previousLoanAt ?? snapshotValue.loanAt)
      const revertLoanByValue =
        parseOptionalString(snapshotValue.previousLoanBy) ?? parseOptionalString(snapshotValue.loanBy)
      const revertLoanBy = revertLoanByValue ?? null

      const loanEntrySnapshot = parseSnapshotLoanEntry(
        snapshotValue.previousLoanEntry ?? snapshotValue.loanEntry,
      )

      const revertOf = typeof targetEntry.markedAt === 'string' ? targetEntry.markedAt : undefined

      const normalizedHistory = Array.isArray(history)
        ? history.map(item => (cloneHistoryEntry(item) ?? item))
        : []

      if (typeof normalizedHistory[targetIndex] === 'object' && normalizedHistory[targetIndex]) {
        ;(normalizedHistory[targetIndex] as Record<string, any>).revertedAt = revertAtIso
        ;(normalizedHistory[targetIndex] as Record<string, any>).revertedBy = adminId ?? 'unknown'
        if (trimmedNote) {
          ;(normalizedHistory[targetIndex] as Record<string, any>).revertNote = trimmedNote
        }
      }

      const revertAuditEntry = {
        reason: 'loan_settlement_reverted',
        revertOf,
        restoredStatus: revertStatus,
        revertedAt: revertAtIso,
        revertedBy: adminId ?? 'unknown',
        ...(trimmedNote ? { note: trimmedNote } : {}),
      }

      normalizedHistory.push(revertAuditEntry)

      metadata[historyKey] = normalizedHistory

      const remainingSettlements = normalizedHistory
        .slice()
        .reverse()
        .find(entry =>
          entry &&
          typeof entry === 'object' &&
          (entry as Record<string, any>).reason === LOAN_SETTLED_METADATA_REASON &&
          !(entry as Record<string, any>).revertedAt,
        )

      if (remainingSettlements && typeof remainingSettlements === 'object') {
        metadata.lastLoanSettlement = remainingSettlements
      } else {
        delete metadata.lastLoanSettlement
      }

      metadata.lastLoanSettlementRevert = revertAuditEntry

      const revertSubMerchantId = order.subMerchantId ?? loanEntrySnapshot?.subMerchantId ?? null

      exportRows.push({
        orderId: order.id,
        subMerchantId: revertSubMerchantId,
        revertStatus,
        revertPendingAmount,
        revertSettlementStatus,
        revertSettlementAmount,
        revertSettlementTime,
        revertLoanedAt,
        revertLoanAmount,
        revertLoanAt,
        revertLoanBy,
        originalMarkedAt: revertOf,
        originalMarkedBy:
          typeof targetEntry.markedBy === 'string' ? targetEntry.markedBy : undefined,
        originalNote: typeof targetEntry.note === 'string' ? targetEntry.note : undefined,
      })

      if (!summary.ok.includes(order.id)) {
        summary.ok.push(order.id)
      }

      if (!exportOnly) {
        updates.push({
          id: order.id,
          metadata,
          status: revertStatus,
          pendingAmount: revertPendingAmount,
          settlementStatus: revertSettlementStatus,
          settlementAmount: revertSettlementAmount,
          settlementTime: revertSettlementTime,
          isLoan: revertIsLoan,
          loanAmount: revertLoanAmount,
          loanAt: revertLoanAt,
          loanBy: revertLoanBy,
          loanedAt: revertLoanedAt,
          subMerchantId: revertSubMerchantId,
          loanEntry: loanEntrySnapshot
            ? {
                id: loanEntrySnapshot.id,
                subMerchantId: loanEntrySnapshot.subMerchantId,
                amount: loanEntrySnapshot.amount,
                metadata: loanEntrySnapshot.metadata,
              }
            : null,
          revertOf,
        })
      }
    }

    if (orders.length < batchSize) {
      cursor = null
      break
    }

    const lastOrder = orders[orders.length - 1]
    cursor = { createdAt: lastOrder.createdAt, id: lastOrder.id }
  }

  if (!exportOnly && updates.length > 0) {
    const events = await applyLoanSettlementRevertUpdates({
      updates,
      summary,
      adminId,
      note: trimmedNote,
      revertAtIso,
    })

    summary.events.push(...events)

    for (const event of events) {
      emitOrderEvent('order.loan_settlement_reverted', event)
    }
  }

  if (exportRows.length > 0 && (exportOnly || summary.ok.length > 0)) {
    summary.exportFile = createCsvExport({
      headers: [
        'Order ID',
        'Sub Merchant ID',
        'Restored Status',
        'Restored Pending Amount',
        'Restored Settlement Status',
        'Restored Settlement Amount',
        'Restored Settlement Time',
        'Restored Loaned At',
        'Restored Loan Amount',
        'Restored Loan At',
        'Restored Loan By',
        'Original Marked At',
        'Original Marked By',
        'Original Note',
      ],
      rows: exportRows.map(row => [
        row.orderId,
        row.subMerchantId ?? '',
        row.revertStatus,
        row.revertPendingAmount ?? '',
        row.revertSettlementStatus ?? '',
        row.revertSettlementAmount ?? '',
        row.revertSettlementTime ? row.revertSettlementTime.toISOString() : '',
        row.revertLoanedAt ? row.revertLoanedAt.toISOString() : '',
        row.revertLoanAmount ?? '',
        row.revertLoanAt ? row.revertLoanAt.toISOString() : '',
        row.revertLoanBy ?? '',
        row.originalMarkedAt ?? '',
        row.originalMarkedBy ?? '',
        row.originalNote ?? '',
      ]),
      fileNamePrefix: `loan-revert-${subMerchantId}`,
      now,
    })
  }

  if (adminId && allOrderIds.length > 0) {
    await logAdminAction(adminId, 'loanRevertSettled', undefined, {
      orderIds: allOrderIds,
      ok: summary.ok,
      fail: summary.fail,
      note: trimmedNote,
      exportOnly: Boolean(exportOnly),
    })
  }

  if (exportOnly) {
    summary.events = []
  }

  return summary
}

