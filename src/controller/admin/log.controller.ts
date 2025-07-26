import { Response } from 'express'
import { prisma } from '../../core/prisma'
import { AuthRequest } from '../../middleware/auth'

export async function listLogs(req: AuthRequest, res: Response) {
  const adminId = req.query.adminId as string | undefined
    const { page = '1', limit = '50' } = req.query
  const pageNum = Math.max(1, parseInt(page as string, 10))
  const pageSize = Math.min(100, parseInt(limit as string, 10))
  const where: any = {}
  if (adminId) where.adminId = adminId

  const [data, total] = await Promise.all([
    prisma.adminLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    prisma.adminLog.count({ where }),
  ])

  res.json({ data, total })
}