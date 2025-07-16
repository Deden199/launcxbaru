// src/controller/merchant/dashboard.controller.ts
import { Response } from 'express'
import { PrismaClient } from '@prisma/client'
import ExcelJS from 'exceljs'
import { AuthRequest } from '../../middleware/auth'
import { parseDateSafely } from '../../util/time'

const prisma = new PrismaClient()

/* ─── util ─── */
function resolveMerchantId(req: AuthRequest): string | undefined {
  if (req.userRole === 'ADMIN') {
    return req.query.merchantId ? String(req.query.merchantId) : undefined
  }
  return req.userId!
}
function parseDate(s?: unknown): Date | undefined {
  return parseDateSafely(s)
}

/* ─── shared fetch ─── */
async function fetchOrders(opts: {
  merchantId?: string
  dateFrom?: Date
  dateTo?: Date
}) {
  const where: any = {}
  if (opts.merchantId) where.merchantId = opts.merchantId
  if (opts.dateFrom || opts.dateTo) {
    where.createdAt = {}
    if (opts.dateFrom) where.createdAt.gte = opts.dateFrom
    if (opts.dateTo)   where.createdAt.lte = opts.dateTo
  }
  return prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, merchantId: true, userId: true, qrPayload: true,
      amount: true, status: true, pendingAmount: true, settlementAmount: true,
      feeLauncx: true, createdAt: true,     paymentReceivedTime:  true,
      settlementTime:       true,
      trxExpirationTime:    true,
    }
  })
}

/* ─── 1) Summary stats ─── */
export const getStats = async (req: AuthRequest, res: Response) => {
  const merchantId = resolveMerchantId(req)
  const dateFrom   = parseDate(req.query.date_from)
  const dateTo     = parseDate(req.query.date_to)

  const orders = await fetchOrders({ merchantId, dateFrom, dateTo })

  const SUC  = ['SUCCESS','DONE','SETTLED']
  const PEND = ['WAIT_FOR_SETTLEMENT','PAID']

  const summary = {
    totalTransaksi: orders
      .filter(o => SUC.includes(o.status))
      .reduce((s,o)=>s+o.amount,0),
    totalPending: orders
      .filter(o => PEND.includes(o.status))
      .reduce((s,o)=>s+(o.pendingAmount||0),0),
    totalSettled: orders
      .filter(o => SUC.includes(o.status))
      .reduce((s,o)=>s+(o.settlementAmount||0),0),
  }
  res.json(summary)
}

/* ─── 2) List transaksi ─── */
export const getTransactions = async (req: AuthRequest, res: Response) => {
  const merchantId = resolveMerchantId(req)
  const dateFrom   = parseDate(req.query.date_from)
  const dateTo     = parseDate(req.query.date_to)

  const orders = await fetchOrders({ merchantId, dateFrom, dateTo })

  const visible = orders.filter(o => !['FAILED','PENDING'].includes(o.status))

  const txs = visible.map(o=>({
    id: o.id,
    merchantId: o.merchantId,
    buyerId: o.userId,
    reference: o.qrPayload ?? '',
    amount: o.amount,
    status: o.status === 'SETTLED' ? 'SUCCESS' : o.status,
    pendingAmount:    o.pendingAmount    ?? 0,
    settlementAmount: o.settlementAmount ?? 0,
    feeLauncx:        o.feeLauncx        ?? 0,
   createdAt:         o.createdAt,  // tetap kirim sebagai Date
  // tiga timestamp baru:
  paymentReceivedTime: o.paymentReceivedTime ?? null,
  settlementTime:      o.settlementTime      ?? null,
  trxExpirationTime:   o.trxExpirationTime   ?? null,  }))

  res.json(txs)
}

/* ─── 3) Export Excel ─── */
export const exportTransactions = async (req: AuthRequest, res: Response) => {
  const merchantId = resolveMerchantId(req)
  const dateFrom   = parseDate(req.query.date_from)
  const dateTo     = parseDate(req.query.date_to)

  const orders = await fetchOrders({ merchantId, dateFrom, dateTo })
  const visible = orders.filter(o => !['FAILED','PENDING'].includes(o.status))

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Transactions')
  ws.columns = [
    { header:'Tanggal',           key:'createdAt',       width:20 },
    { header:'Merchant ID',       key:'merchantId',      width:20 },
    { header:'Buyer ID',          key:'buyerId',         width:18 },
    { header:'Referensi',         key:'reference',       width:30 },
    { header:'Jumlah',            key:'amount',          width:15 },
    { header:'Status',            key:'status',          width:18 },
    { header:'Pending Amount',    key:'pendingAmount',   width:18 },
    { header:'Settlement Amount', key:'settlementAmount',width:18 },
    { header:'Fee Launcx',        key:'feeLauncx',       width:15 },
  ]

  visible.forEach(o=>{
    ws.addRow({
      createdAt:        o.createdAt.toISOString(),
     paidAt:           o.paymentReceivedTime
                        ? new Date(o.paymentReceivedTime).toISOString()
                        : '',
     settledAt:        o.settlementTime
                        ? new Date(o.settlementTime).toISOString()
                        : '',
     expiresAt:        o.trxExpirationTime
                        ? new Date(o.trxExpirationTime).toISOString()
                        : '',
      merchantId:       o.merchantId,
      buyerId:          o.userId,
      reference:        o.qrPayload ?? '',
      amount:           o.amount,
      status:           o.status === 'SETTLED' ? 'SUCCESS' : o.status,
      pendingAmount:    o.pendingAmount    ?? 0,
      settlementAmount: o.settlementAmount ?? 0,
      feeLauncx:        o.feeLauncx        ?? 0,
    })
  })

  res.setHeader('Content-Disposition','attachment; filename=transactions.xlsx')
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  await wb.xlsx.write(res)
  res.end()
}
