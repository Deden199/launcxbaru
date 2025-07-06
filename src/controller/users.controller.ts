// src/controllers/users.controller.ts
import { Request, Response } from 'express'
import { prisma } from '../core/prisma'
import { hashPassword } from '../util/password'

export async function listUsers(req: Request, res: Response) {
  const data = await prisma.partnerUser.findMany({ where: { isActive: true } })
  res.json({ data })
}

export async function createUser(req: Request, res: Response) {
  const { name, email, password, role } = req.body
  const pwd = await hashPassword(password)
  const u = await prisma.partnerUser.create({
    data: { name, email, password: pwd, role },
  })
  res.status(201).json({ data: u })
}

export async function updateUser(req: Request, res: Response) {
  const { id } = req.params
  const updateData: any = { ...req.body }
  if (updateData.password) {
    updateData.password = await hashPassword(updateData.password)
  }
  const u = await prisma.partnerUser.update({
    where: { id },
    data: updateData,
  })
  res.json({ data: u })
}

export async function deleteUser(req: Request, res: Response) {
  const { id } = req.params
  await prisma.partnerUser.update({
    where: { id },
    data: { isActive: false },
  })
  res.status(204).send()
}
