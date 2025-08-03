// File: src/controllers/admin/subMerchant.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../core/prisma';
import { z } from 'zod';
import { parseRawCredential, normalizeCredentials } from '../../util/credentials';


const scheduleSchema = z.object({
  weekday: z.boolean(),
  weekend: z.boolean(),
});
const nameSchema = z.string().min(1)

const providerSchema = z.enum(['hilogate', 'oy', 'netzme', '2c2p', 'gidi']);

// GET /admin/merchant/:merchantId/pg
export async function listSubMerchants(req: Request, res: Response) {
  const merchantId = req.params.merchantId;
  const subs = await prisma.sub_merchant.findMany({
    where: { merchantId },
    select: {
      id: true,
            name: true,

      credentials: true,
      schedule: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return res.json(subs);
}

// POST /admin/merchant/:merchantId/pg
export async function createSubMerchant(req: Request, res: Response) {
  const merchantId = req.params.merchantId;
  // parse dan validasi body
    const name = nameSchema.parse(req.body.name);

  const provider = providerSchema.parse(req.body.provider)
  const rawCreds = parseRawCredential(provider, req.body.credentials)
  const credentials = normalizeCredentials(provider, rawCreds)
  const schedule = scheduleSchema.parse(req.body.schedule)

  const created = await prisma.sub_merchant.create({
    data: {
      merchant:    { connect: { id: merchantId } },
      provider,
            name,

      credentials,
      schedule,
    },
  });
  return res.status(201).json(created);
}

export async function updateSubMerchant(req: Request, res: Response) {
  const { merchantId, subId } = req.params

  try {
    // Pastikan sub-merchant ada dan milik merchant yang benar
    const existing = await prisma.sub_merchant.findUnique({
      where: { id: subId },
      select: { merchantId: true, provider: true }
    })
    if (!existing) {
      return res.status(404).json({ error: 'Sub-merchant tidak ditemukan.' })
    }
    if (existing.merchantId !== merchantId) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses untuk mengubah sub-merchant ini.' })
    }

    // Validasi input dan bangun objek data
    const data: any = {}
        let provider = existing.provider

    if (req.body.provider !== undefined) {
      provider = providerSchema.parse(req.body.provider)
      data.provider = provider    }
    if (req.body.name !== undefined) {
      data.name = nameSchema.parse(req.body.name)
    }
    if (req.body.credentials !== undefined) {
      const raw = parseRawCredential(provider, req.body.credentials)
      data.credentials = normalizeCredentials(provider, raw)    }
    if (req.body.schedule !== undefined) {
      data.schedule = scheduleSchema.parse(req.body.schedule)
    }

    // Update di database
    const updated = await prisma.sub_merchant.update({
      where: { id: subId },
      data,
    })

    return res.json(updated)
  } catch (err: any) {
    console.error('Gagal update sub-merchant:', err)
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors.map((e: any) => e.message).join(', ') })
    }
    return res.status(500).json({ error: 'Terjadi kesalahan saat memperbarui data.' })
  }
}

// DELETE /admin/merchant/:merchantId/pg/:subId
export async function deleteSubMerchant(req: Request, res: Response) {
  const { subId } = req.params;
  await prisma.sub_merchant.delete({ where: { id: subId } });
  return res.status(204).send();
}
