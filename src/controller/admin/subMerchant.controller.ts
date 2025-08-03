// File: src/controllers/admin/subMerchant.controller.ts
import { Request, Response } from 'express'
import { prisma } from '../../core/prisma'
import { z, ZodError } from 'zod'
import {
  parseRawCredential,
  normalizeCredentials,
} from '../../util/credentials' // sesuaikan path jika beda

// Shared schema
const scheduleSchema = z.object({
  weekday: z.boolean(),
  weekend: z.boolean(),
})
const nameSchema = z.string().min(1)

// Provider termasuk gidi sekarang
const providerSchema = z.enum(['hilogate', 'oy', 'netzme', '2c2p', 'gidi'])

// GET /admin/merchant/:merchantId/pg
export async function listSubMerchants(req: Request, res: Response) {
  const merchantId = req.params.merchantId
  const subs = await prisma.sub_merchant.findMany({
    where: { merchantId },
    select: {
      id: true,
      name: true,
      provider: true,
      credentials: true, // sudah ternormalisasi
      schedule: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return res.json(subs)
}

// POST /admin/merchant/:merchantId/pg
export async function createSubMerchant(req: Request, res: Response) {
  const merchantId = req.params.merchantId

  try {
    const name = nameSchema.parse(req.body.name)
    const provider = providerSchema.parse(req.body.provider)
    const rawCred = parseRawCredential(provider, req.body.credentials)
    const normalized = normalizeCredentials(provider, rawCred)
    const schedule = scheduleSchema.parse(req.body.schedule)

    const created = await prisma.sub_merchant.create({
      data: {
        merchant: { connect: { id: merchantId } },
        provider,
        name,
        credentials: normalized, // simpan bentuk ternormalisasi
        schedule,
      },
    })
    return res.status(201).json(created)
  } catch (err: any) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors.map(e => e.message).join(', ') })
    }
    console.error('Gagal membuat sub-merchant:', err)
    return res.status(500).json({ error: 'Terjadi kesalahan saat membuat sub-merchant.' })
  }
}

export async function updateSubMerchant(req: Request, res: Response) {
  const { merchantId, subId } = req.params

  try {
    // Validasi kepemilikan
    const existing = await prisma.sub_merchant.findUnique({
      where: { id: subId },
      select: { merchantId: true, provider: true },
    })
    if (!existing) {
      return res.status(404).json({ error: 'Sub-merchant tidak ditemukan.' })
    }
    if (existing.merchantId !== merchantId) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses untuk mengubah sub-merchant ini.' })
    }

    // Bangun data update
    const data: any = {}
    if (req.body.provider !== undefined) {
      data.provider = providerSchema.parse(req.body.provider)
    }
    if (req.body.name !== undefined) {
      data.name = nameSchema.parse(req.body.name)
    }
    if (req.body.credentials !== undefined) {
      const prov = data.provider ?? existing.provider
      const rawCred = parseRawCredential(prov, req.body.credentials)
      data.credentials = normalizeCredentials(prov, rawCred)
    }
    if (req.body.schedule !== undefined) {
      data.schedule = scheduleSchema.parse(req.body.schedule)
    }

    const updated = await prisma.sub_merchant.update({
      where: { id: subId },
      data,
    })
    return res.json(updated)
  } catch (err: any) {
    console.error('Gagal update sub-merchant:', err)
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors.map((e: any) => e.message).join(', ') })
    }
    return res.status(500).json({ error: 'Terjadi kesalahan saat memperbarui data.' })
  }
}

// DELETE /admin/merchant/:merchantId/pg/:subId
export async function deleteSubMerchant(req: Request, res: Response) {
  const { subId } = req.params
  await prisma.sub_merchant.delete({ where: { id: subId } })
  return res.status(204).send()
}
