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
}

export type OrderForLoanSettlement = {
  id: string
  status: string
  pendingAmount: number | null | undefined
  settlementAmount: number | null | undefined
  settlementStatus: string | null | undefined
  settlementTime: Date | null | undefined
  metadata: unknown
  subMerchantId: string | null | undefined
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
  loanedAt: string | null
  loanEntry?: LoanSettlementLoanEntrySnapshot | null
  previousStatus: string
  previousPendingAmount: number | null
  previousSettlementStatus: string | null
  previousSettlementAmount: number | null
  previousSettlementTime: string | null
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
  const loanedAt = order.loanedAt ? order.loanedAt.toISOString() : null
  const loanEntrySnapshot = createLoanEntrySnapshot(order.loanEntry)

  return {
    status: order.status,
    pendingAmount,
    settlementStatus: order.settlementStatus ?? null,
    settlementAmount,
    settlementTime,
    loanedAt,
    loanEntry: loanEntrySnapshot,
    previousStatus: order.status,
    previousPendingAmount: pendingAmount,
    previousSettlementStatus: order.settlementStatus ?? null,
    previousSettlementAmount: settlementAmount,
    previousSettlementTime: settlementTime,
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
              where: { id: update.id, status: update.originalStatus },
              data: {
                status: ORDER_STATUS.LN_SETTLED,
                pendingAmount: null,
                settlementStatus: null,
                settlementTime: null,
                settlementAmount: null,
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

            let amount = Number(update.pendingAmount ?? 0)
            if ((!Number.isFinite(amount) || amount <= 0) && update.settlementAmount != null) {
              const fallback = Number(update.settlementAmount)
              amount = Number.isFinite(fallback) ? fallback : 0
            }

            if (Number.isFinite(amount) && amount > 0 && update.subMerchantId) {
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
                  amount,
                  metadata: loanEntryMetadata,
                },
                update: {
                  amount,
                  metadata: loanEntryMetadata,
                },
              })
            }

            events.push({
              orderId: update.id,
              previousStatus: update.originalStatus,
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
        status: { in: [...LOAN_ADJUSTABLE_STATUSES] },
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
        settlementTime: true,
        metadata: true,
        subMerchantId: true,
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
    for (const order of orders) {
      allOrderIds.push(order.id)

      const metadata = normalizeMetadata(order.metadata)
      const auditEntry = createLoanSettlementAuditEntry({
        order,
        adminId,
        markedAtIso,
        note: trimmedNote,
      })

      const previousLoanEntry = createLoanEntrySnapshot(order.loanEntry)

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
        originalStatus: order.status,
        settlementAmount: order.settlementAmount,
        previousLoanEntry,
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

type LoanSettlementRevertExportRow = {
  orderId: string
  subMerchantId: string | null | undefined
  revertStatus: string
  revertPendingAmount: number | null
  revertSettlementStatus: string | null
  revertSettlementAmount: number | null
  revertSettlementTime: Date | null
  revertLoanedAt: Date | null
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

  let cursor: { loanedAt: Date; id: string } | null = null
  const updates: LoanSettlementRevertUpdate[] = []

  while (true) {
    const orders = (await prisma.order.findMany({
      where: {
        subMerchantId,
        status: ORDER_STATUS.LN_SETTLED,
        ...(normalizedOrderIds ? { id: { in: Array.from(normalizedOrderIds) } } : {}),
        loanedAt: {
          gte: start,
          lte: end,
        },
        ...(cursor
          ? {
              OR: [
                { loanedAt: { gt: cursor.loanedAt } },
                {
                  loanedAt: cursor.loanedAt,
                  id: { gt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [
        { loanedAt: 'asc' },
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
    if (lastOrder.loanedAt) {
      cursor = { loanedAt: lastOrder.loanedAt, id: lastOrder.id }
    } else {
      cursor = null
    }
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

