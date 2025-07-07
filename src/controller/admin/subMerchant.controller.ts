// File: src/controllers/admin/subMerchant.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../core/prisma';
import { z } from 'zod';

// Validasi schema
const credentialsSchema = z.object({
  merchantId: z.string(),
  env: z.enum(['sandbox', 'production']),
  secretKey: z.string(),
});
const scheduleSchema = z.object({
  weekday: z.boolean(),
  weekend: z.boolean(),
});
const providerSchema = z.enum(['hilogate', 'oy', 'netzme', '2c2p']);

// GET /admin/merchant/:merchantId/pg
export async function listSubMerchants(req: Request, res: Response) {
  const merchantId = req.params.merchantId;
  const subs = await prisma.sub_merchant.findMany({
    where: { merchantId },
    select: {
      id: true,
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
  const provider = providerSchema.parse(req.body.provider);
  const credentials = credentialsSchema.parse(req.body.credentials);
  const schedule = scheduleSchema.parse(req.body.schedule);

  const created = await prisma.sub_merchant.create({
    data: {
      merchant:    { connect: { id: merchantId } },
      provider,
      credentials,
      schedule,
    },
  });
  return res.status(201).json(created);
}

// PATCH /admin/merchant/:merchantId/pg/:subId
export async function updateSubMerchant(req: Request, res: Response) {
  const { merchantId, subId } = req.params;
  // input validation
  const data: any = {};
  if (req.body.provider) {
    data.provider = providerSchema.parse(req.body.provider);
  }
  if (req.body.credentials) {
    data.credentials = credentialsSchema.parse(req.body.credentials);
  }
  if (req.body.schedule) {
    data.schedule = scheduleSchema.parse(req.body.schedule);
  }

  const updated = await prisma.sub_merchant.update({
    where: { id: subId },
    data,
  });
  return res.json(updated);
}

// DELETE /admin/merchant/:merchantId/pg/:subId
export async function deleteSubMerchant(req: Request, res: Response) {
  const { subId } = req.params;
  await prisma.sub_merchant.delete({ where: { id: subId } });
  return res.status(204).send();
}
