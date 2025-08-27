import { Response } from 'express'
import { prisma } from '../core/prisma'
import { ClientAuthRequest } from '../middleware/clientAuth'

export async function getClientApiLogs(req: ClientAuthRequest, res: Response) {
  const { page = '1', limit = '50' } = req.query as Record<string, any>
  const pageNum = Math.max(1, parseInt(String(page), 10))
  const pageSize = Math.min(100, parseInt(String(limit), 10))

  const skip = (pageNum - 1) * pageSize
  const take = pageSize + skip

  const allowed = [req.partnerClientId!, ...(req.childrenIds ?? [])]

  const [jobs, deadLetters, totalJobs, totalDeadLetters] = await Promise.all([
    prisma.callbackJob.findMany({
      where: { partnerClientId: { in: allowed } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        attempts: true,
        delivered: true,
        createdAt: true,
        updatedAt: true,
        lastError: true,
        responseBody: true,
      },
    }),
    prisma.callbackJobDeadLetter.findMany({
      where: { partnerClientId: { in: allowed } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        attempts: true,
        createdAt: true,
        statusCode: true,
        errorMessage: true,
        responseBody: true,
      },
    }),
    prisma.callbackJob.count({ where: { partnerClientId: { in: allowed } } }),
    prisma.callbackJobDeadLetter.count({ where: { partnerClientId: { in: allowed } } }),
  ])

  const merged = [
    ...jobs.map(j => ({
      id: j.id,
      status: j.delivered ? 'DELIVERED' : 'PENDING',
      attempts: j.attempts,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      statusCode: (j.lastError as any)?.statusCode ?? null,
      errorMessage: (j.lastError as any)?.message ?? null,
      responseBody: j.responseBody ?? null,
    })),
    ...deadLetters.map(d => ({
      id: d.id,
      status: 'FAILED',
      attempts: d.attempts,
      createdAt: d.createdAt,
      updatedAt: d.createdAt,
      statusCode: d.statusCode ?? null,
      errorMessage: d.errorMessage ?? null,
      responseBody: d.responseBody ?? null,
    })),
  ]

  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const rows = merged.slice(skip, skip + pageSize)
  const total = totalJobs + totalDeadLetters

  return res.json({ rows, total })
}
