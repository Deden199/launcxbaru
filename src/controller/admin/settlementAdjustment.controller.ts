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
    const getFee = (id: string, existing?: number | null) => {
      if (typeof feeInput === 'number') return feeInput
      if (feeInput && typeof feeInput === 'object') return feeInput[id] ?? existing ?? 0
      return existing ?? 0
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

    await prisma.$transaction(async tx => {
      await Promise.all([
        ...orders.map(o => {
          const netAmount = o.amount - (o.fee3rdParty ?? 0)
          const newFee = getFee(o.id, o.feeLauncx ?? undefined)
          const { settlement: settlementAmount } = computeSettlement(netAmount, { flat: newFee })
          updates.push({ id: o.id, model: 'order', settlementAmount })
          return tx.order
            .update({
              where: { id: o.id },
              data: {
                settlementStatus,
                ...(settlementTime && { settlementTime: new Date(settlementTime) }),
                feeLauncx: newFee,
                settlementAmount,
                ...(settlementStatus === 'SETTLED' && { pendingAmount: null }),
              },
            })
            .then(logProgress)
        }),
        ...oldTrx.map(t => {
          const netAmount = t.settlementAmount ?? t.amount
          const newFee = getFee(t.id)
          const { settlement: settlementAmount } = computeSettlement(netAmount, { flat: newFee })
          updates.push({ id: t.id, model: 'trx', settlementAmount })
          return tx.transaction_request
            .update({
              where: { id: t.id },
              data: {
                ...(settlementTime && { settlementAt: new Date(settlementTime) }),
                settlementAmount,
              },
            })
            .then(logProgress)
        }),
      ])
    })

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

