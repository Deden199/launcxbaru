// src/controllers/merchants.controller.ts
import { Request, Response } from 'express'
import { prisma } from '../core/prisma'

export async function listMerchants(req: Request, res: Response) {
  const merchants = await prisma.merchant.findMany()
  res.json({ data: merchants })
}

export async function createMerchant(req: Request, res: Response) {
  const m = await prisma.merchant.create({ data: req.body })
  res.status(201).json({ data: m })
}

export async function updateMerchant(req: Request, res: Response) {
  const { id } = req.params
  const m = await prisma.merchant.update({
    where: { id },
    data: req.body,
  })
  res.json({ data: m })
}

export async function deleteMerchant(req: Request, res: Response) {
  const { id } = req.params
  await prisma.merchant.delete({ where: { id } })
  res.status(204).send()
}
