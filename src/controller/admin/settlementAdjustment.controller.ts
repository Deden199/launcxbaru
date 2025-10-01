import { Response } from 'express'
import { prisma } from '../../core/prisma'
import { AuthRequest } from '../../middleware/auth'
import { logAdminAction } from '../../util/adminLog'
import {
  applySettlementAdjustments,
  runSettlementAdjustmentJob,
} from '../../service/settlementAdjustmentJob'
import {
  getSettlementAdjustmentJob,
  startSettlementAdjustmentWorker,
} from '../../worker/settlementAdjustmentJob'

const REVERSAL_ALLOWED_STATUS = new Set(['SETTLED', 'DONE', 'SUCCESS', 'LN_SETTLED'])
const REVERSAL_BATCH_SIZE = 25

type OrderReversalRecord = {
  id: string
  status: string | null
  settlementTime: Date | null
  settlementAmount: number | null
  amount: number | null
  fee3rdParty: number | null
  feeLauncx: number | null
  metadata: unknown
  subMerchantId: string | null
  partnerClientId: string | null
  loanEntry?: {
    amount: number | null
    metadata: unknown
    subMerchantId: string
  } | null
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function calculateReversalAmount(
  order: Pick<OrderReversalRecord, 'settlementAmount' | 'amount' | 'fee3rdParty' | 'feeLauncx'>
) {
  if (order.settlementAmount != null) {
    return Number(order.settlementAmount) || 0
  }
  const amount = Number(order.amount ?? 0)
  const fee3rdParty = Number(order.fee3rdParty ?? 0)
  const feeLauncx = Number(order.feeLauncx ?? 0)
  const net = amount - fee3rdParty - feeLauncx
  return Number.isFinite(net) ? Math.max(net, 0) : 0
}

export async function getEligibleSettlements(req: AuthRequest, res: Response) {
  const {
    subMerchantId,
    settled_from: settledFrom,
    settled_to: settledTo,
    q,
    page = '1',
    size = '25',
    sort = '-settlementTime',
  } = req.query as Record<string, unknown>

  if (typeof subMerchantId !== 'string' || !subMerchantId.trim()) {
    return res.status(400).json({ error: 'subMerchantId is required' })
  }

  if (typeof settledFrom !== 'string' || typeof settledTo !== 'string') {
    return res.status(400).json({ error: 'settled_from and settled_to are required' })
  }

  const fromDate = new Date(settledFrom)
  const toDate = new Date(settledTo)

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return res.status(400).json({ error: 'Invalid settlement date range' })
  }

  if (fromDate.getTime() >= toDate.getTime()) {
    return res.status(400).json({ error: 'settled_from must be before settled_to' })
  }

  const pageNum = Math.max(1, parseInt(String(page), 10) || 1)
  const requestedPageSize = Number(size)

  if (!Number.isFinite(requestedPageSize) || !Number.isInteger(requestedPageSize)) {
    console.warn('[getEligibleSettlements] Invalid page size received', {
      rawSize: size,
      subMerchantId,
    })
    return res.status(400).json({ error: 'size must be a positive integer' })
  }

  if (requestedPageSize <= 0) {
    console.warn('[getEligibleSettlements] Non-positive page size received', {
      requestedSize: requestedPageSize,
      subMerchantId,
    })
    return res.status(400).json({ error: 'size must be a positive integer' })
  }

  if (requestedPageSize > 1500) {
    console.warn('[getEligibleSettlements] Requested page size exceeds limit', {
      requestedSize: requestedPageSize,
      subMerchantId,
    })
    return res.status(400).json({ error: 'size must be 1500 or less' })
  }

  const pageSize = requestedPageSize

  const sortField = typeof sort === 'string' ? sort : '-settlementTime'
  const sortKey = sortField.startsWith('-') ? sortField.slice(1) : sortField
  const sortDirection = sortField.startsWith('-') ? 'desc' : 'asc'

  const orderBy: Record<string, 'asc' | 'desc'> = {}
  if (sortKey === 'settlementTime') {
    orderBy.settlementTime = sortDirection
  } else if (sortKey === 'amount') {
    orderBy.amount = sortDirection
  } else {
    orderBy.settlementTime = 'desc'
  }

  const where: any = {
    subMerchantId: subMerchantId.trim(),
    status: { in: Array.from(REVERSAL_ALLOWED_STATUS) },
    settlementTime: {
      not: null,
      gte: fromDate,
      lt: toDate,
    },
  }

  const keyword = typeof q === 'string' ? q.trim() : ''
  if (keyword) {
    where.OR = [
      { id: { contains: keyword, mode: 'insensitive' } },
      { rrn: { contains: keyword, mode: 'insensitive' } },
    ]
  }

  try {
    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          subMerchantId: true,
          status: true,
          settlementTime: true,
          settlementAmount: true,
          amount: true,
          feeLauncx: true,
          fee3rdParty: true,
        },
      }),
      prisma.order.count({ where }),
    ])

    const data = rows.map(row => ({
      id: row.id,
      subMerchantId: row.subMerchantId,
      status: row.status,
      settlementTime: row.settlementTime?.toISOString() ?? null,
      settlementAmount: row.settlementAmount ?? null,
      amount: row.amount ?? null,
      feeLauncx: row.feeLauncx ?? null,
      fee3rdParty: row.fee3rdParty ?? null,
    }))

    return res.json({
      data,
      total,
      page: pageNum,
      size: pageSize,
    })
  } catch (err) {
    console.error('[getEligibleSettlements]', err)
    return res.status(500).json({ error: 'internal error' })
  }
}

export async function adjustSettlements(req: AuthRequest, res: Response) {
  const {
    transactionIds,
    dateFrom,
    dateTo,
    settlementStatus,
    settlementTime,
    feeLauncx,
    subMerchantId,
  } = req.body as any

  if (!settlementStatus) {
    return res.status(400).json({ error: 'settlementStatus required' })
  }

  const hasIds = Array.isArray(transactionIds) && transactionIds.length > 0
  const hasDateRange = Boolean(dateFrom || dateTo)
  if (hasIds && hasDateRange) {
    return res.status(400).json({ error: 'provide either transactionIds or date range, not both' })
  }

  if (!hasIds && !hasDateRange) {
    return res.status(400).json({ error: 'transactionIds or date range required' })
  }

  try {
    if (hasIds) {
      const orderWhere: any = { status: 'PAID', id: { in: transactionIds } }
      const trxWhere: any = { status: 'SUCCESS', id: { in: transactionIds } }
      if (typeof subMerchantId === 'string' && subMerchantId.trim()) {
        orderWhere.subMerchantId = subMerchantId.trim()
        trxWhere.subMerchantId = subMerchantId.trim()
      }

      const [orders, oldTrx] = await Promise.all([
        prisma.order.findMany({
          where: orderWhere,
          select: {
            id: true,
            amount: true,
            fee3rdParty: true,
            feeLauncx: true,
            subMerchantId: true,
          },
        }),
        prisma.transaction_request.findMany({
          where: trxWhere,
          select: {
            id: true,
            amount: true,
            settlementAmount: true,
            subMerchantId: true,
          },
        }),
      ])

      const result = await applySettlementAdjustments(
        { orders, transactions: oldTrx },
        { settlementStatus, settlementTime, feeConfig: feeLauncx, targetSubMerchantId: subMerchantId }
      )

      if (req.userId) {
        await logAdminAction(req.userId, 'adjustSettlements', null, {
          transactionIds,
          settlementStatus,
          settlementTime,
          feeLauncx,
          updated: [
            ...result.updatedOrderIds.map(id => ({ id, model: 'order' })),
            ...result.updatedTransactionIds.map(id => ({ id, model: 'trx' })),
          ],
        })
      }

      return res.json({
        data: {
          updated: result.updatedOrderIds.length + result.updatedTransactionIds.length,
          ids: [...result.updatedOrderIds, ...result.updatedTransactionIds],
        },
      })
    }

    if (typeof subMerchantId !== 'string' || !subMerchantId.trim()) {
      return res.status(400).json({ error: 'subMerchantId is required for date range adjustment' })
    }
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom and dateTo are required for date range adjustment' })
    }

    const summary = await runSettlementAdjustmentJob(
      {
        subMerchantId: subMerchantId.trim(),
        settlementStatus,
        start: dateFrom,
        end: dateTo,
        feeConfig: feeLauncx,
        settlementTime,
      },
      {
        onProgress: progress => {
          if (progress.total > 0 && progress.processed % 100 === 0) {
            console.log('[adjustSettlements] progress', progress)
          }
        },
      }
    )

    const updatedIds = [...summary.updatedOrderIds, ...summary.updatedTransactionIds]

    if (req.userId) {
      await logAdminAction(req.userId, 'adjustSettlements', null, {
        subMerchantId: subMerchantId.trim(),
        dateFrom,
        dateTo,
        settlementStatus,
        settlementTime,
        feeLauncx,
        updated: [
          ...summary.updatedOrderIds.map(id => ({ id, model: 'order' })),
          ...summary.updatedTransactionIds.map(id => ({ id, model: 'trx' })),
        ],
      })
    }

    return res.json({
      data: {
        updated: updatedIds.length,
        ids: updatedIds,
        totals: {
          orders: summary.totalOrders,
          transactions: summary.totalTransactions,
        },
        range: {
          start: summary.startBoundary.toISOString(),
          end: summary.endBoundary.toISOString(),
        },
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal error' })
  }
}

export async function startSettlementAdjustmentJob(req: AuthRequest, res: Response) {
  const body = req.body as {
    subMerchantId?: unknown
    settled_from?: unknown
    settled_to?: unknown
    settlementStatus?: unknown
    feeLauncx?: unknown
    settlementTime?: unknown
  }

  const subMerchantId = typeof body.subMerchantId === 'string' ? body.subMerchantId.trim() : ''
  if (!subMerchantId) {
    return res.status(400).json({ error: 'subMerchantId is required' })
  }

  const settledFrom = typeof body.settled_from === 'string' ? body.settled_from : undefined
  const settledTo = typeof body.settled_to === 'string' ? body.settled_to : undefined

  if (!settledFrom || !settledTo) {
    return res.status(400).json({ error: 'settled_from and settled_to are required' })
  }

  const settlementStatus = typeof body.settlementStatus === 'string' ? body.settlementStatus : ''
  if (!settlementStatus) {
    return res.status(400).json({ error: 'settlementStatus is required' })
  }

  try {
    const job = startSettlementAdjustmentWorker({
      subMerchantId,
      settlementStatus,
      start: settledFrom,
      end: settledTo,
      feeConfig: body.feeLauncx as any,
      settlementTime: body.settlementTime as any,
      adminId: req.userId ?? undefined,
    })
    return res.status(202).json(job)
  } catch (err) {
    console.error('[startSettlementAdjustmentJob]', err)
    return res.status(500).json({ error: 'internal error' })
  }
}

export async function settlementAdjustmentStatus(req: AuthRequest, res: Response) {
  const jobId = req.params.jobId
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' })
  }

  const job = getSettlementAdjustmentJob(jobId)
  if (!job) {
    return res.status(404).json({ error: 'job not found' })
  }

  return res.json(job)
}

export async function reverseSettlementToLnSettle(req: AuthRequest, res: Response) {
  const body = req.body as {
    orderIds?: unknown
    subMerchantId?: unknown
    reason?: unknown
  }

  const rawIds = Array.isArray(body?.orderIds) ? body.orderIds : []
  const ids = Array.from(
    new Set(
      rawIds
        .map(id => (typeof id === 'string' ? id.trim() : ''))
        .filter((id): id is string => Boolean(id))
    )
  )

  if (ids.length === 0) {
    return res.status(400).json({ error: 'orderIds is required' })
  }

  if (body?.subMerchantId && typeof body.subMerchantId !== 'string') {
    return res.status(400).json({ error: 'subMerchantId must be a string' })
  }

  const subMerchantId = typeof body?.subMerchantId === 'string' ? body.subMerchantId : undefined
  const reasonInput = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const reason = reasonInput ? reasonInput : undefined

  try {
    const orders = (await prisma.order.findMany({
      where: {
        id: { in: ids },
        ...(subMerchantId ? { subMerchantId } : {}),
      },
      select: {
        id: true,
        status: true,
        settlementTime: true,
        settlementAmount: true,
        amount: true,
        fee3rdParty: true,
        feeLauncx: true,
        metadata: true,
        subMerchantId: true,
        partnerClientId: true,
        loanEntry: {
          select: {
            amount: true,
            metadata: true,
            subMerchantId: true,
          },
        },
      },
    })) as OrderReversalRecord[]

    const orderMap = new Map(orders.map(order => [order.id, order]))

    const errors: { id: string; message: string }[] = []
    let ok = 0
    let totalReversalAmount = 0
    const now = new Date()
    const ordersToReverse: {
      id: string
      where: Record<string, unknown>
      data: Record<string, unknown>
      reversalAmount: number
      partnerClientId: string | null
      subMerchantId: string | null
      existingLoanEntry: OrderReversalRecord['loanEntry']
    }[] = []
    for (const id of ids) {
      const order = orderMap.get(id)
      if (!order) {
        errors.push({ id, message: 'Order tidak ditemukan atau tidak sesuai sub-merchant' })
        continue
      }

      if (order.status === 'LN_SETTLE' && !order.settlementTime) {
        ok += 1
        continue
      }

      if (!REVERSAL_ALLOWED_STATUS.has(order.status ?? '')) {
        errors.push({ id, message: `Status ${order.status ?? 'UNKNOWN'} tidak dapat direversal` })
        continue
      }

      if (!order.settlementTime) {
        errors.push({ id, message: 'Order belum memiliki settlementTime' })
        continue
      }

      const metadataSource = isPlainObject(order.metadata) ? { ...order.metadata } : {}
      const mergedMetadata = {
        ...metadataSource,
        reversal: true,
        previousStatus: order.status,
        previousSettlementTime: order.settlementTime,
        previousSettlementAmount: order.settlementAmount ?? null,
        reason: reason ?? null,
        reversedAt: now,
        reversedBy: req.userId ?? null,
      }
      const reversalAmount = calculateReversalAmount(order)

      const resolvedSubMerchantId =
        order.subMerchantId ?? order.loanEntry?.subMerchantId ?? null

      ordersToReverse.push({
        id: order.id,
        where: {
          id: order.id,
          status: { in: Array.from(REVERSAL_ALLOWED_STATUS) },
          settlementTime: { not: null },
          ...(subMerchantId ? { subMerchantId } : {}),
        },
        data: {
          status: 'LN_SETTLE',
          settlementTime: null,
          settlementAmount: null,
          settlementStatus: null,
          pendingAmount: null,
          loanedAt: now,
          metadata: mergedMetadata,
        },
        reversalAmount,
        partnerClientId: order.partnerClientId,
        subMerchantId: resolvedSubMerchantId,
        existingLoanEntry: order.loanEntry ?? null,
      })
    }

    const partnerBalanceAdjustments = new Map<string, number>()

    for (let i = 0; i < ordersToReverse.length; i += REVERSAL_BATCH_SIZE) {
      const batch = ordersToReverse.slice(i, i + REVERSAL_BATCH_SIZE)
      const batchOutcome = await prisma.$transaction(async tx => {
        const batchResults = await Promise.all(
          batch.map(async item => ({
            item,
            result: await tx.order.updateMany({
              where: item.where,
              data: item.data,
            }),
          }))
        )

        const successfulItems = batchResults
          .filter(({ result }) => result && result.count > 0)
          .map(({ item }) => item)

        const updateErrors = batchResults
          .filter(({ result }) => !result || result.count === 0)
          .map(({ item }) => ({
            id: item.id,
            message: 'Order gagal diperbarui (mungkin sudah diubah)',
          }))

        const missingPartnerOrders: string[] = []
        const loanEntryErrors: { id: string; message: string }[] = []
        const partnerAdjustments = new Map<string, number>()
        for (const item of successfulItems) {
          if (item.partnerClientId) {
            const total = partnerAdjustments.get(item.partnerClientId) ?? 0
            partnerAdjustments.set(item.partnerClientId, total + item.reversalAmount)
          } else {
            missingPartnerOrders.push(item.id)
          }
        }

        for (const item of successfulItems) {
          if (!item.subMerchantId) {
            loanEntryErrors.push({
              id: item.id,
              message: 'Order berhasil direversal tetapi tidak memiliki subMerchantId untuk loan entry',
            })
            continue
          }

          const baseLoanMetadata = isPlainObject(item.existingLoanEntry?.metadata)
            ? { ...item.existingLoanEntry!.metadata }
            : {}

          const loanMetadata = {
            ...baseLoanMetadata,
            lastAction: 'reverseSettlementToLnSettle',
            reversal: {
              amount: item.reversalAmount,
              reason: reason ?? null,
              reversedAt: now.toISOString(),
              reversedBy: req.userId ?? null,
            },
          }

          await tx.loanEntry.upsert({
            where: { orderId: item.id },
            update: {
              amount: item.reversalAmount,
              subMerchantId: item.subMerchantId,
              metadata: loanMetadata,
            },
            create: {
              orderId: item.id,
              amount: item.reversalAmount,
              subMerchantId: item.subMerchantId,
              metadata: loanMetadata,
            },
          })
        }

        await Promise.all(
          Array.from(partnerAdjustments.entries()).map(([partnerClientId, amount]) =>
            tx.partnerClient.update({
              where: { id: partnerClientId },
              data: { balance: { decrement: amount } },
            })
          )
        )

        return {
          successfulItems,
          updateErrors,
          missingPartnerOrders,
          partnerAdjustments: Array.from(partnerAdjustments.entries()).map(
            ([partnerClientId, amount]) => ({ partnerClientId, amount })
          ),
          loanEntryErrors,
        }
      })

      for (const item of batchOutcome.successfulItems) {
        ok += 1
        totalReversalAmount += item.reversalAmount
      }

      for (const err of batchOutcome.updateErrors) {
        errors.push(err)
      }

      for (const missingId of batchOutcome.missingPartnerOrders) {
        errors.push({
          id: missingId,
          message: 'Order berhasil direversal tetapi tidak memiliki partnerClientId untuk penyesuaian saldo',
        })
      }

      for (const loanErr of batchOutcome.loanEntryErrors) {
        errors.push(loanErr)
      }

      for (const adjustment of batchOutcome.partnerAdjustments) {
        const total = partnerBalanceAdjustments.get(adjustment.partnerClientId) ?? 0
        partnerBalanceAdjustments.set(adjustment.partnerClientId, total + adjustment.amount)
      }
    }

    const processed = ids.length
    const fail = processed - ok

    if (req.userId) {
      await logAdminAction(req.userId, 'reverseSettlementToLnSettle', null, {
        orderIds: ids,
        subMerchantId,
        reason,
        processed,
        ok,
        fail,
        totalReversalAmount,
        errors,
        partnerBalanceAdjustments: Array.from(partnerBalanceAdjustments.entries()).map(
          ([partnerClientId, amount]) => ({ partnerClientId, amount })
        ),
      })
    }

    return res.json({
      processed,
      ok,
      fail,
      totalReversalAmount,
      errors,
      partnerBalanceAdjustments: Array.from(partnerBalanceAdjustments.entries()).map(
        ([partnerClientId, amount]) => ({ partnerClientId, amount })
      ),
    })
  } catch (err) {
    console.error('reverseSettlementToLnSettle error', err)
    return res.status(500).json({ error: 'internal error' })
  }
}

