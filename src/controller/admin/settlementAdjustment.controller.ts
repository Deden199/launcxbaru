import { Response } from 'express'
import { prisma } from '../../core/prisma'
import { AuthRequest } from '../../middleware/auth'
import { logAdminAction } from '../../util/adminLog'
import { computeSettlement } from '../../service/feeSettlement'

export async function adjustSettlements(req: AuthRequest, res: Response) {
  const { transactionIds, dateFrom, dateTo, settlementStatus, settlementTime, feeLauncx } = req.body as any

  if (!settlementStatus) {
    return res.status(400).json({ error: 'settlementStatus required' })
  }

  const where: any = {}
  if (Array.isArray(transactionIds) && transactionIds.length > 0) {
    where.id = { in: transactionIds }
  } else if (dateFrom || dateTo) {
    const createdAt: any = {}
    if (dateFrom) createdAt.gte = new Date(dateFrom)
    if (dateTo) createdAt.lte = new Date(dateTo)
    where.createdAt = createdAt
  } else {
    return res.status(400).json({ error: 'transactionIds or date range required' })
  }

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      amount: true,
      fee3rdParty: true,
      feeLauncx: true,
    }
  })

  const oldTrx = await prisma.transaction_request.findMany({
    where,
    select: {
      id: true,
      amount: true,
      settlementAmount: true,
    }
  })

  const feeInput = feeLauncx
  const getFee = (id: string, existing?: number | null) => {
    if (typeof feeInput === 'number') return feeInput
    if (feeInput && typeof feeInput === 'object') return feeInput[id] ?? existing ?? 0
    return existing ?? 0
  }

  const updates: { id: string; model: 'order' | 'trx'; settlementAmount: number }[] = []

  for (const o of orders) {
    const netAmount = o.amount - (o.fee3rdParty ?? 0)
    const newFee = getFee(o.id, o.feeLauncx ?? undefined)
    const { settlement: settlementAmount } = computeSettlement(netAmount, { flat: newFee })
    await prisma.order.update({
      where: { id: o.id },
      data: {
        settlementStatus,
        ...(settlementTime && { settlementTime: new Date(settlementTime) }),
        feeLauncx: newFee,
        settlementAmount,
        pendingAmount: null,
      }
    })
    updates.push({ id: o.id, model: 'order', settlementAmount })
  }

  for (const t of oldTrx) {
    const netAmount = t.settlementAmount ?? t.amount
    const newFee = getFee(t.id)
    const { settlement: settlementAmount } = computeSettlement(netAmount, { flat: newFee })
    await prisma.transaction_request.update({
      where: { id: t.id },
      data: {
        status: settlementStatus,
        ...(settlementTime && { settlementAt: new Date(settlementTime) }),
        settlementAmount,
      }
    })
    updates.push({ id: t.id, model: 'trx', settlementAmount })
  }

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

  res.json({ data: { updated: updates.length } })
}

