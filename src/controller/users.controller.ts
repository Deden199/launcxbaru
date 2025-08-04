// src/controllers/users.controller.ts
import { Response } from 'express'
import { prisma } from '../core/prisma'
import { hashPassword } from '../util/password'
import { AuthRequest } from '../middleware/auth'
import { logAdminAction } from '../util/adminLog'


export async function listUsers(req: AuthRequest, res: Response) {
  const data = await prisma.partnerUser.findMany({ where: { isActive: true } })
  res.json({ data })
}

export async function createUser(req: AuthRequest, res: Response) {
  const { name, email, password, role } = req.body
  const pwd = await hashPassword(password)
  const u = await prisma.partnerUser.create({
    data: { name, email, password: pwd, role },
  })
    if (req.userId) {
    await logAdminAction(req.userId, 'createUser', u.id)
  }
  res.status(201).json({ data: u })
}

export async function updateUser(req: AuthRequest, res: Response) {
  const { id } = req.params
  const updateData: any = { ...req.body }
  if (updateData.password) {
    updateData.password = await hashPassword(updateData.password)
  }
  const u = await prisma.partnerUser.update({
    where: { id },
    data: updateData,
  })
    if (req.userId) {
    await logAdminAction(req.userId, 'updateUser', id)
  }
  res.json({ data: u })
}

export async function deleteUser(req: AuthRequest, res: Response) {
  const { id } = req.params
  await prisma.partnerUser.update({
    where: { id },
    data: { isActive: false },
  })
    if (req.userId) {
    await logAdminAction(req.userId, 'deleteUser', id)
  }
  res.status(204).send()
}
