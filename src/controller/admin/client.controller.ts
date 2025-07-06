// src/controllers/admin/client.controller.ts
import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// 1) List semua API-Clients
// src/controllers/admin/client.controller.ts

export const getAllClients = async (_: Request, res: Response) => {
  const clients = await prisma.partnerClient.findMany({
    select: {
      id:         true,
      name:       true,
      apiKey:     true,
      apiSecret:  true,
      isActive:   true,
      feePercent: true,
      feeFlat:    true,
      defaultProvider:true,          // ← include defaultProvider
      parentClient: {              // ← ambil relasi parent
        select: { id: true, name: true }
      },
      children: {                  // ← ambil relasi children
        select: { id: true, name: true }
      }
    }
  })
  res.json(clients)
}

// 2) Create API-Client baru + default ClientUser
export const createClient = async (req: Request, res: Response) => {
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

  if (isNaN(feePercent) || feePercent < 0 || feePercent > 100) {
    return res.status(400).json({ error: 'feePercent must be between 0 and 100' })
  }
  if (isNaN(feeFlat) || feeFlat < 0) {
    return res.status(400).json({ error: 'feeFlat must be >= 0' })
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
      defaultProvider: 'hilogate',   // ← set defaultProvider fallback

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
    defaultProvider:  client.defaultProvider,  // ← include defaultProvider
    createdAt: client.createdAt,
    parentClientId: client.parentClient?.id ?? null,
    childrenIds: client.children.map(c => c.id)
  })
}


// 4) Update API-Client by ID
export const updateClient = async (req: Request, res: Response) => {
  const { clientId } = req.params
  const {
    name,
    isActive,
    feePercent,
    feeFlat,
    defaultProvider,        // ← include in body
    parentClientId = null,
    childrenIds = []
  } = req.body as {
    name?: string
    isActive?: boolean
    feePercent?: number
    feeFlat?: number
    defaultProvider?: string       // ← add this line
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
  data.parentClientId = parentClientId || null
if (defaultProvider != null) {
  const dp = String(defaultProvider).trim().toLowerCase()
  // validasi: hanya izinkan nama provider yang tersedia
  const allowed = ['hilogate', 'oy', 'gv']  // atau daftar dinamis dari PG
  if (!allowed.includes(dp)) {
    return res.status(400).json({ error: `defaultProvider must be one of ${allowed.join(', ')}` })
  }
  data.defaultProvider = dp
}
  // 1) update utama
  const updated = await prisma.partnerClient.update({ where: { id: clientId }, data })

  // 2) lepas relasi parentClientId dari anak lama yang dikeluarkan
  await prisma.partnerClient.updateMany({
    where: { parentClientId: clientId, id: { notIn: childrenIds } },
    data: { parentClientId: null }
  })

  // 3) pasang relasi parentClientId untuk anak yang dipilih
  if (childrenIds.length) {
    await prisma.partnerClient.updateMany({
      where: { id: { in: childrenIds } },
      data:  { parentClientId: clientId }
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

// // 6) List koneksi PG untuk satu client
// export const listClientPG = async (req: Request, res: Response) => {
//   const { clientId } = req.params
//   const conns = await prisma.clientPG.findMany({
//     where: { clientId },
//     select: { id: true, clientId: true, pgProviderId: true, clientFee: true, activeDays: true }
//   })
//   res.json(conns)
// }

// // 7) Upsert koneksi PG (create or update)
// export const createClientPG = async (req: Request, res: Response) => {
//   const { clientId } = req.params
//   const { pgProviderId, clientFee, activeDays } = req.body
//   if (!pgProviderId || clientFee == null || !Array.isArray(activeDays)) {
//     return res.status(400).json({ error: 'pgProviderId, clientFee & activeDays are required' })
//   }
//   const item = await prisma.clientPG.upsert({
//     where: { clientId_pgProviderId: { clientId, pgProviderId } },
//     update: { clientFee, activeDays },
//     create: { clientId, pgProviderId, clientFee, activeDays }
//   })
//   res.json(item)
// }

// // 8) Update koneksi PG by ID
// export const updateClientPG = async (req: Request, res: Response) => {
//   const { id } = req.params
//   const { clientFee, activeDays } = req.body
//   if (clientFee == null || !Array.isArray(activeDays)) {
//     return res.status(400).json({ error: 'clientFee & activeDays are required' })
//   }
//   const item = await prisma.clientPG.update({
//     where: { id },
//     data: { clientFee, activeDays }
//   })
//   res.json(item)
// }

// // 9) Delete koneksi PG
// export const deleteClientPG = async (_: Request, res: Response) => {
//   const { id } = res.locals.params as any
//   await prisma.clientPG.delete({ where: { id } })
//   res.status(204).end()
// }
