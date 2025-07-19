// src/controllers/admin/client.controller.ts
import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import { AuthRequest } from '../../middleware/auth'

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
      defaultProvider: 'hilogate',
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
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'createClient',
        target: client.id
      }
    })
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
    const allowed = ['hilogate', 'oy', 'gv']
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
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'updateClient',
        target: clientId
      }
    })
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