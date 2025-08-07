// src/controllers/admin/client.controller.ts
import { Request, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import { AuthRequest } from '../../middleware/auth'
import { parseDateSafely } from '../../util/time'
import { PrismaClient, DisbursementStatus } from '@prisma/client'
import { logAdminAction } from '../../util/adminLog'

const prisma = new PrismaClient()

// 1) List all clients with withdraw fee settings
export const getAllClients = async (_: Request, res: Response) => {
  const clients = await prisma.partnerClient.findMany({
    select: {
      id:             true,
      name:           true,
      apiKey:         true,
      apiSecret:      true,
      isActive:       true,
      feePercent:     true,
      feeFlat:        true,
      weekendFeePercent: true,
      weekendFeeFlat:    true,
      withdrawFeePercent: true,
      withdrawFeeFlat:    true,
      forceSchedule:      true,
      defaultProvider:    true,
      
      parentClient: {
        select: { id: true, name: true }
      },
      children: {
        select: { id: true, name: true }
      }
    }
  })
  res.json(clients)
}

// 2) Create API-Client baru + default ClientUser
export const createClient = async (req: AuthRequest, res: Response) => {
  const name  = (req.body.name  as string)?.trim()
  const email = (req.body.email as string)?.trim()

  if (!name || !email) {
    return res.status(400).json({ error: 'Name dan email wajib diisi' })
  }

  // parse & validate fee
  const feePercent = req.body.feePercent != null
    ? Number(req.body.feePercent)
    : 0
  const feeFlat = req.body.feeFlat != null
    ? Number(req.body.feeFlat)
    : 0
      const weekendFeePercent = req.body.weekendFeePercent != null
    ? Number(req.body.weekendFeePercent)
    : 0
  const weekendFeeFlat = req.body.weekendFeeFlat != null
    ? Number(req.body.weekendFeeFlat)
    : 0
  const withdrawFeePercent = req.body.withdrawFeePercent != null
    ? Number(req.body.withdrawFeePercent)
    : 0
  const withdrawFeeFlat = req.body.withdrawFeeFlat != null
    ? Number(req.body.withdrawFeeFlat)
    : 0
  const forceSchedule =
    typeof req.body.forceSchedule === 'string' &&
    ['weekday', 'weekend'].includes(req.body.forceSchedule)
      ? req.body.forceSchedule
      : null

        const defaultProvider =
    typeof req.body.defaultProvider === 'string'
      ? req.body.defaultProvider.trim().toLowerCase()
      : 'hilogate'
  const allowedDp = ['hilogate', 'oy', 'gv', 'gidi']
  if (!allowedDp.includes(defaultProvider)) {
    return res.status(400).json({ error: `defaultProvider must be one of ${allowedDp.join(', ')}` })
  }
  if (isNaN(feePercent) || feePercent < 0 || feePercent > 100) {
    return res.status(400).json({ error: 'feePercent must be between 0 and 100' })
  }
  if (isNaN(feeFlat) || feeFlat < 0) {
    return res.status(400).json({ error: 'feeFlat must be >= 0' })
  }
  if (isNaN(weekendFeePercent) || weekendFeePercent < 0 || weekendFeePercent > 100) {
    return res.status(400).json({ error: 'weekendFeePercent must be between 0 and 100' })
  }
  if (isNaN(weekendFeeFlat) || weekendFeeFlat < 0) {
    return res.status(400).json({ error: 'weekendFeeFlat must be >= 0' })
  }
  if (isNaN(withdrawFeePercent) || withdrawFeePercent < 0 || withdrawFeePercent > 100) {
    return res.status(400).json({ error: 'withdrawFeePercent must be between 0 and 100' })
  }
  if (isNaN(withdrawFeeFlat) || withdrawFeeFlat < 0) {
    return res.status(400).json({ error: 'withdrawFeeFlat must be >= 0' })
  }

  // 2a) buat PartnerClient
  const apiKey    = crypto.randomUUID()
  const apiSecret = crypto.randomUUID()
  const client    = await prisma.partnerClient.create({
    data: {
      name,
      apiKey,
      apiSecret,
      isActive:   true,
      feePercent,
      feeFlat,
       weekendFeePercent,
      weekendFeeFlat,
      withdrawFeePercent,
      withdrawFeeFlat,
      forceSchedule,
      defaultProvider,
    }
  })

  // 2b) buat ClientUser dengan default password "123456"
  const defaultPassword = '123456'
  const hash = await bcrypt.hash(defaultPassword, 10)
  await prisma.clientUser.create({
    data: {
      partnerClientId: client.id,
      email,
      password: hash,
      role: 'PARTNER_CLIENT'
    }
  })
  if (req.userId) {
    await logAdminAction(req.userId, 'createClient', client.id)
  }
  // 2c) kembalikan data client + kredensial default
  res.status(201).json({
    client,
    defaultUser: {
      email,
      password: defaultPassword
    }
  })
}

// 3) Get single client by ID
export const getClientById = async (req: Request, res: Response) => {
  const { clientId } = req.params
  const client = await prisma.partnerClient.findUnique({
    where: { id: clientId },
    include: {
      parentClient: { select: { id: true } },
      children:     { select: { id: true } }
    }
  })
  if (!client) return res.status(404).json({ error: 'Client not found' })

  res.json({
    id: client.id,
    name: client.name,
    apiKey: client.apiKey,
    apiSecret: client.apiSecret,
    isActive: client.isActive,
    feePercent: client.feePercent,
    feeFlat: client.feeFlat,
    weekendFeePercent: client.weekendFeePercent,
    weekendFeeFlat: client.weekendFeeFlat,
    withdrawFeePercent: client.withdrawFeePercent,
    withdrawFeeFlat: client.withdrawFeeFlat,
    forceSchedule:  client.forceSchedule,
    defaultProvider:  client.defaultProvider,
    createdAt: client.createdAt,
    parentClientId: client.parentClient?.id ?? null,
    childrenIds: client.children.map(c => c.id)
  })
}

// 4) Update API-Client by ID
export const updateClient = async (req: AuthRequest, res: Response) => {
  const { clientId } = req.params
  const {
    name,
    isActive,
    feePercent,
    feeFlat,
    weekendFeePercent,
    weekendFeeFlat,
    withdrawFeePercent,
    withdrawFeeFlat,
    defaultProvider,
    forceSchedule,
    parentClientId = null,
    childrenIds = []
  } = req.body as {
    name?: string
    isActive?: boolean
    feePercent?: number
    feeFlat?: number
    weekendFeePercent?: number
    weekendFeeFlat?: number
    withdrawFeePercent?: number
    withdrawFeeFlat?: number
    defaultProvider?: string
    forceSchedule?: string
    parentClientId?: string | null
    childrenIds?: string[]
  }

  // validasi sederhana
  const data: any = {}
  if (name) data.name = name.trim()
  if (typeof isActive === 'boolean') data.isActive = isActive
  if (feePercent != null) {
    const f = Number(feePercent)
    if (isNaN(f) || f < 0 || f > 100)
      return res.status(400).json({ error: 'feePercent must be between 0 and 100' })
    data.feePercent = f
  }
  if (feeFlat != null) {
    const f = Number(feeFlat)
    if (isNaN(f) || f < 0)
      return res.status(400).json({ error: 'feeFlat must be >= 0' })
    data.feeFlat = f
  }
    if (weekendFeePercent != null) {
    const wf = Number(weekendFeePercent)
    if (isNaN(wf) || wf < 0 || wf > 100)
      return res.status(400).json({ error: 'weekendFeePercent must be between 0 and 100' })
    data.weekendFeePercent = wf
  }
  if (weekendFeeFlat != null) {
    const wf = Number(weekendFeeFlat)
    if (isNaN(wf) || wf < 0)
      return res.status(400).json({ error: 'weekendFeeFlat must be >= 0' })
    data.weekendFeeFlat = wf
  }
  if (forceSchedule !== undefined) {
    const fs = String(forceSchedule).trim().toLowerCase()
    if (fs === '' || forceSchedule === null) {
      data.forceSchedule = null
    } else {
      if (!['weekday', 'weekend'].includes(fs)) {
        return res.status(400).json({ error: 'forceSchedule must be weekday or weekend' })
      }
      data.forceSchedule = fs
    }
  }
  if (withdrawFeePercent != null) {
    const wf = Number(withdrawFeePercent)
    if (isNaN(wf)|| wf < 0 || wf > 100)
      return res.status(400).json({ error: 'withdrawFeePercent must be between 0 and 100' })
    data.withdrawFeePercent = wf
  }
  if (withdrawFeeFlat != null) {
    const wf = Number(withdrawFeeFlat)
    if (isNaN(wf)|| wf < 0)
      return res.status(400).json({ error: 'withdrawFeeFlat must be >= 0' })
    data.withdrawFeeFlat = wf
  }
  if (defaultProvider != null) {
    const dp = String(defaultProvider).trim().toLowerCase()
    const allowed = ['hilogate', 'oy', 'gv', 'gidi']
    if (!allowed.includes(dp)) {
      return res.status(400).json({ error: `defaultProvider must be one of ${allowed.join(', ')}` })
    }
    data.defaultProvider = dp
  }
  data.parentClientId = parentClientId || null

  // update utama
  const updated = await prisma.partnerClient.update({ where: { id: clientId }, data })

  // lepas relasi parentClientId dari anak lama
  await prisma.partnerClient.updateMany({
    where: { parentClientId: clientId, id: { notIn: childrenIds } },
    data: { parentClientId: null }
  })

  // pasang relasi parentClientId untuk anak yang dipilih
  if (childrenIds.length) {
    await prisma.partnerClient.updateMany({
      where: { id: { in: childrenIds } },
      data:  { parentClientId: clientId }
    })
  }
  if (req.userId) {
    await logAdminAction(req.userId, 'updateClient', clientId)
  }
  res.json(updated)
}

// 5) List semua PG-providers
export const listProviders = async (_: Request, res: Response) => {
  const providers = await prisma.pGProvider.findMany({
    select: { id: true, name: true, credentials: true }
  })
  res.json(providers)
}

const DASHBOARD_STATUSES = [
  'SUCCESS',
  'DONE',
  'SETTLED',
  'PAID',
  'PENDING',
  'EXPIRED',
]

export const getClientDashboardAdmin = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params

    const pc = await prisma.partnerClient.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        name: true,
        balance: true,
        children: {
          select: { id: true, name: true, balance: true }
        }
      }
    })
    if (!pc) return res.status(404).json({ error: 'Client tidak ditemukan' })

    const dateFrom = req.query.date_from ? new Date(String(req.query.date_from)) : undefined
    const dateTo   = req.query.date_to   ? new Date(String(req.query.date_to))   : undefined
    const createdAtFilter: { gte?: Date; lte?: Date } = {}
    if (dateFrom) createdAtFilter.gte = dateFrom
    if (dateTo)   createdAtFilter.lte = dateTo

    const rawStatus = (req.query as any).status
    const allowed = DASHBOARD_STATUSES as readonly string[]
    let statuses: string[] = []
    if (Array.isArray(rawStatus)) {
      statuses = rawStatus.map(String).filter(s => allowed.includes(s))
    } else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
      statuses = rawStatus.split(',').map(s => s.trim()).filter(s => allowed.includes(s))
    }
    if (statuses.length === 0) statuses = [...allowed]

    let ids: string[]
    if (typeof req.query.clientId === 'string' && req.query.clientId !== 'all' && req.query.clientId.trim()) {
      ids = [req.query.clientId]
    } else if (pc.children.length > 0) {
      ids = [pc.id, ...pc.children.map(c => c.id)]
    } else {
      ids = [pc.id]
    }

    const pendingAgg = await prisma.order.aggregate({
      _sum: { pendingAmount: true },
      where: {
        partnerClientId: { in: ids },
        status: 'PAID',
        ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
      }
    })
    const totalPending = pendingAgg._sum.pendingAmount ?? 0

    const parentBal = ids.includes(pc.id) ? pc.balance ?? 0 : 0
    const childrenBal = pc.children.filter(c => ids.includes(c.id)).reduce((sum, c) => sum + (c.balance ?? 0), 0)
    const totalActive = parentBal + childrenBal

    const orders = await prisma.order.findMany({
      where: {
        partnerClientId: { in: ids },
        status: { in: DASHBOARD_STATUSES },
        ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        qrPayload: true,
        rrn: true,
        playerId: true,
        amount: true,
        feeLauncx: true,
        settlementAmount: true,
        pendingAmount: true,
        status: true,
        settlementStatus: true,
        createdAt: true,
        paymentReceivedTime: true,
        settlementTime: true,
        trxExpirationTime: true,
      }
    })

    const totalAgg = await prisma.order.aggregate({
      _sum: { amount: true },
      where: {
        partnerClientId: { in: ids },
        status: { in: statuses },
        ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
      }
    })
    const totalTransaksi = totalAgg._sum.amount ?? 0

    const transactions = orders.map(o => {
      const netSettle = o.status === 'PAID' ? (o.pendingAmount ?? 0) : (o.settlementAmount ?? 0)
      return {
        id: o.id,
        date: o.createdAt.toISOString(),
        reference: o.qrPayload ?? '',
        rrn: o.rrn ?? '',
        playerId: o.playerId,
        amount: o.amount,
        feeLauncx: o.feeLauncx ?? 0,
        netSettle,
        settlementStatus: o.settlementStatus ?? '',
        status:
          o.status === 'SETTLED' ? 'SUCCESS'
          : o.status === 'DONE'   ? 'PAID'
          : o.status,
                  paymentReceivedTime: o.paymentReceivedTime?.toISOString() ?? '',
        settlementTime: o.settlementTime?.toISOString() ?? '',
        trxExpirationTime: o.trxExpirationTime?.toISOString() ?? '',
      }
    })

    return res.json({
      balance: totalActive,
      totalPending,
      totalTransaksi,
      transactions,
      children: pc.children,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' })
  }
}

export const getClientWithdrawalsAdmin = async (req: AuthRequest, res: Response) => {
  const { clientId } = req.params
  const { status, date_from, date_to, page = '1', limit = '20' } = req.query

  const fromDate = parseDateSafely(date_from)
  const toDate   = parseDateSafely(date_to)

  const where: any = { partnerClientId: clientId }
  if (status) where.status = status as string
  if (fromDate || toDate) {
    where.createdAt = {}
    if (fromDate) where.createdAt.gte = fromDate
    if (toDate)   where.createdAt.lte = toDate
  }

  const pageNum  = Math.max(1, parseInt(page as string, 10))
  const pageSize = Math.min(100, parseInt(limit as string, 10))

  const [rows, total] = await Promise.all([
    prisma.withdrawRequest.findMany({
      where,
      skip:  (pageNum - 1) * pageSize,
      take:  pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        refId: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        amount: true,
        netAmount: true,
        pgFee: true,
        withdrawFeePercent: true,
        withdrawFeeFlat: true,
        status: true,
        createdAt: true,
        completedAt: true,
        subMerchant: { select: { name: true, provider: true } },
      },
    }),
    prisma.withdrawRequest.count({ where }),
  ])

  const data = rows.map(w => ({
    refId: w.refId,
    bankName: w.bankName,
    accountName: w.accountName,
    accountNumber: w.accountNumber,
    amount: w.amount,
    netAmount: w.netAmount,
    pgFee: w.pgFee ?? null,
    withdrawFeePercent: w.withdrawFeePercent,
    withdrawFeeFlat: w.withdrawFeeFlat,
    status: w.status,
    createdAt: w.createdAt.toISOString(),
    completedAt: w.completedAt?.toISOString() ?? null,
    wallet: w.subMerchant?.name ?? w.subMerchant?.provider ?? null,
  }))

  res.json({ data, total })
}

// 7) Get list of sub-wallet balances for a client
export const getClientSubWallets = async (req: Request, res: Response) => {
  const { clientId } = req.params as { clientId: string }

  const client = await prisma.partnerClient.findUnique({
    where: { id: clientId },
    select: { defaultProvider: true },
  })
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const provider = client.defaultProvider || 'hilogate'

  const subs = await prisma.sub_merchant.findMany({
    where: { provider },
    select: { id: true, name: true, provider: true },
  })

  const result = await Promise.all(
    subs.map(async (s) => {
      const inAgg = await prisma.order.aggregate({
        _sum: { settlementAmount: true },
        where: {
          subMerchantId: s.id,
          partnerClientId: clientId,
          settlementTime: { not: null },
        },
      })
      const totalIn = inAgg._sum.settlementAmount ?? 0

      const outAgg = await prisma.withdrawRequest.aggregate({
        _sum: { amount: true },
        where: {
          subMerchantId: s.id,
          partnerClientId: clientId,
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] },
        },
      })
      const totalOut = outAgg._sum.amount ?? 0

      return {
        id: s.id,
        name: s.name,
        provider: s.provider,
        balance: totalIn - totalOut,
      }
    })
  )

  res.json(result)
}

// 8) Reconcile client balance
export const reconcileClientBalance = async (req: AuthRequest, res: Response) => {
  const { clientId } = req.params as { clientId: string }

  const settlementAgg = await prisma.order.aggregate({
    _sum: { settlementAmount: true },
    where: {
      partnerClientId: clientId,
      settlementTime: { not: null },
    },
  })
  const totalSettlement = settlementAgg._sum.settlementAmount ?? 0

  const withdrawAgg = await prisma.withdrawRequest.aggregate({
    _sum: { amount: true },
    where: {
      partnerClientId: clientId,
      status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] },
    },
  })
  const totalWithdraw = withdrawAgg._sum.amount ?? 0

  const newBalance = totalSettlement - totalWithdraw

  await prisma.partnerClient.update({
    where: { id: clientId },
    data: { balance: newBalance },
  })

  if (req.userId) {
    await logAdminAction(req.userId, 'reconcileClientBalance', clientId)
  }

  res.json({ balance: newBalance })
}