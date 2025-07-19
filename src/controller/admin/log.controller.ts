import { Response } from 'express'
import { prisma } from '../../core/prisma'
import { AuthRequest } from '../../middleware/auth'

export async function listLogs(req: AuthRequest, res: Response) {
  const adminId = req.query.adminId as string | undefined
  const where: any = {}
  if (adminId) where.adminId = adminId
  const data = await prisma.adminLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })
  res.json({ data })
}