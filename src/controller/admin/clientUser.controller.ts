import { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../../core/prisma'
import { AuthRequest } from '../../middleware/auth'
import { logAdminAction } from '../../util/adminLog'

// List all ClientUser of a PartnerClient
export const listClientUsers = async (req: Request, res: Response) => {
  const { clientId } = req.params
  const users = await prisma.clientUser.findMany({
    where: { partnerClientId: clientId, isActive: true },
    select: { id: true, email: true }
  })
  res.json(users)
}

// Create new ClientUser for a PartnerClient
export const createClientUser = async (req: AuthRequest, res: Response) => {
  const { clientId } = req.params
  const { email, password } = req.body as { email?: string; password?: string }

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' })
  }

  const exists = await prisma.clientUser.findUnique({ where: { email } })
  if (exists) {
    return res.status(400).json({ error: 'Email already used' })
  }

  const hash = await bcrypt.hash(password, 10)
  const user = await prisma.clientUser.create({
    data: {
      partnerClientId: clientId,
      email,
      password: hash,
      role: 'PARTNER_CLIENT'
    },
    select: { id: true, email: true }
  })

  if (req.userId) {
    await logAdminAction(req.userId, 'createClientUser', user.id)
  }

  res.status(201).json(user)
}

// Deactivate/delete a ClientUser
export const deleteClientUser = async (req: AuthRequest, res: Response) => {
  const { userId } = req.params
  await prisma.clientUser.delete({
    where: { id: userId }
  })

  if (req.userId) {
    await logAdminAction(req.userId, 'deleteClientUser', userId)
  }

  res.status(204).end()
}