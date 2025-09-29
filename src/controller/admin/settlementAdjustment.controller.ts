import { Response } from 'express'
import { prisma } from '../../core/prisma'
import { AuthRequest } from '../../middleware/auth'
import { logAdminAction } from '../../util/adminLog'
import { computeSettlement } from '../../service/feeSettlement'

const REVERSAL_ALLOWED_STATUS = new Set(['SETTLED', 'DONE', 'SUCCESS'])

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
  const { transactionIds, dateFrom, dateTo, settlementStatus, settlementTime, feeLauncx } = req.body as any

  if (!settlementStatus) {
    return res.status(400).json({ error: 'settlementStatus required' })
  }

  const hasIds = Array.isArray(transactionIds) && transactionIds.length > 0
  const hasDateRange = Boolean(dateFrom || dateTo)
  if (hasIds && hasDateRange) {
    return res.status(400).json({ error: 'provide either transactionIds or date range, not both' })
  }

  const orderWhere: any = { status: 'PAID' }
  const trxWhere: any = { status: 'SUCCESS' }
  if (hasIds) {
    orderWhere.id = { in: transactionIds }
    trxWhere.id = { in: transactionIds }
  } else if (hasDateRange) {
    const createdAt: any = {}
    if (dateFrom) createdAt.gte = new Date(dateFrom)
    if (dateTo) createdAt.lte = new Date(dateTo)
    orderWhere.createdAt = createdAt
    trxWhere.createdAt = createdAt
  } else {
    return res.status(400).json({ error: 'transactionIds or date range required' })
  }

  try {
    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        amount: true,
        fee3rdParty: true,
        feeLauncx: true,
      }
    })

    const oldTrx = await prisma.transaction_request.findMany({
      where: trxWhere,
      select: {
        id: true,
        amount: true,
        settlementAmount: true,
      }
    })

    const feeInput = feeLauncx
    const getFeePct = (id: string, existingFee?: number | null, baseAmount?: number) => {
      if (typeof feeInput === 'number') return feeInput
      if (feeInput && typeof feeInput === 'object') {
        const val = feeInput[id]
        if (typeof val === 'number') return val
      }
      if (existingFee != null && baseAmount) {
        return (existingFee / baseAmount) * 100
      }
      return 0
    }

    const updates: { id: string; model: 'order' | 'trx'; settlementAmount: number }[] = []
    const totalItems = orders.length + oldTrx.length
    console.log(`Adjusting settlements for ${totalItems} records`)
    let processed = 0
    const logProgress = () => {
      processed++
      if (processed % 50 === 0 || processed === totalItems) {
        console.log(`Processed ${processed}/${totalItems}`)
      }
    }

    const isFinalSettlement = ['SETTLED', 'DONE', 'SUCCESS', 'COMPLETED'].includes(settlementStatus)

    const batchSize = 200
    const records = [
      ...orders.map(o => ({ type: 'order' as const, data: o })),
      ...oldTrx.map(t => ({ type: 'trx' as const, data: t })),
    ]

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const batchUpdates = await prisma.$transaction(
        async tx => {
          const bu: { id: string; model: 'order' | 'trx'; settlementAmount: number }[] = []
          for (const item of batch) {
            if (item.type === 'order') {
              const o = item.data
              const netAmount = o.amount - (o.fee3rdParty ?? 0)
              const feePct = getFeePct(o.id, o.feeLauncx ?? undefined, netAmount)
              const { fee, settlement } = computeSettlement(netAmount, { percent: feePct })
              const result = await tx.order.updateMany({
                where: { id: o.id, status: 'PAID' },
                data: {
                  settlementStatus,
                  ...(settlementTime && { settlementTime: new Date(settlementTime) }),
                  feeLauncx: fee,
                  settlementAmount: settlement,
                },
              })
              if (result.count > 0) {
                if (isFinalSettlement) {
                  await tx.order.updateMany({
                    where: { id: o.id },
                    data: { status: 'SETTLED', pendingAmount: null },
                  })
                }
                bu.push({ id: o.id, model: 'order', settlementAmount: settlement })
              }
            } else {
              const t = item.data
              const netAmount = t.settlementAmount ?? t.amount
              const feePct = getFeePct(t.id)
              const { settlement } = computeSettlement(netAmount, { percent: feePct })
              await tx.transaction_request.update({
                where: { id: t.id },
                data: {
                  ...(settlementTime && { settlementAt: new Date(settlementTime) }),
                  settlementAmount: settlement,
                },
              })
              bu.push({ id: t.id, model: 'trx', settlementAmount: settlement })
            }
          }
          return bu
        },
        prismaTxOptions
      )
      updates.push(...batchUpdates)
      batchUpdates.forEach(() => logProgress())
    }

    console.log(`Settlement adjustment completed for ${processed} records`)

    if (req.userId) {
      await logAdminAction(req.userId, 'adjustSettlements', null, {
        transactionIds,
        dateFrom,
        dateTo,
        settlementStatus,
        settlementTime,
        feeLauncx,
        updated: updates.map(u => ({ id: u.id, model: u.model, settlementAmount: u.settlementAmount })),
      })
    }

    res.json({ data: { updated: updates.length, ids: updates.map(u => u.id) } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'internal error' })
  }
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
      },
    })) as OrderReversalRecord[]

    const orderMap = new Map(orders.map(order => [order.id, order]))

    const errors: { id: string; message: string }[] = []
    let ok = 0
    let totalReversalAmount = 0
    const now = new Date()

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

      const updateResult = await prisma.order.updateMany({
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
          pendingAmount: 0,
          loanedAt: now,
          metadata: mergedMetadata,
        },
      })

      if (updateResult.count === 0) {
        errors.push({ id, message: 'Order gagal diperbarui (mungkin sudah diubah)' })
        continue
      }

      ok += 1
      totalReversalAmount += calculateReversalAmount(order)
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
      })
    }

    return res.json({ processed, ok, fail, totalReversalAmount, errors })
  } catch (err) {
    console.error('reverseSettlementToLnSettle error', err)
    return res.status(500).json({ error: 'internal error' })
  }
}

