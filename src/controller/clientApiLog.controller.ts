import { Response } from 'express'
import { prisma } from '../core/prisma'
import { ClientAuthRequest } from '../middleware/clientAuth'

type LogOrigin = 'callback-job' | 'callback-dead-letter' | 'client-request'

interface NormalisedLog {
  id: string
  origin: LogOrigin
  url: string | null
  method: string | null
  path: string | null
  statusCode: number | null
  errorMessage: string | null
  responseBody: string | null
  payload: string | null
  createdAt: Date
  respondedAt: Date | null
}

export async function getClientApiLogs(req: ClientAuthRequest, res: Response) {
  const { page = '1', limit = '50', date_from, date_to, success } = req.query as Record<string, any>
  const pageNum = Math.max(1, parseInt(String(page), 10))
  const pageSize = Math.min(100, parseInt(String(limit), 10))

  const skip = (pageNum - 1) * pageSize
  const take = pageSize + skip

  const dateFrom = parseDate(date_from)
  const dateTo = parseDate(date_to)
  const statusFilter = parseStatusFilter(success)

  const allowed = [req.partnerClientId!, ...(req.childrenIds ?? [])]

  const createdAtFilter = buildDateFilter(dateFrom, dateTo)

  const baseCallbackWhere = {
    partnerClientId: { in: allowed },
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  }

  const [jobs, deadLetters, requestLogs] = await Promise.all([
    prisma.callbackJob.findMany({
      where: baseCallbackWhere,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        url: true,
        attempts: true,
        delivered: true,
        createdAt: true,
        updatedAt: true,
        lastError: true,
        responseBody: true,
      },
    }),
    prisma.callbackJobDeadLetter.findMany({
      where: baseCallbackWhere,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        url: true,
        attempts: true,
        createdAt: true,
        statusCode: true,
        errorMessage: true,
        responseBody: true,
      },
    }),
    prisma.clientApiRequestLog.findMany({
      where: {
        partnerClientId: { in: allowed },
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        method: true,
        path: true,
        statusCode: true,
        errorMessage: true,
        responseBody: true,
        payload: true,
        createdAt: true,
      },
    }),
  ])

  const merged: NormalisedLog[] = [
    ...jobs.map((j): NormalisedLog => ({
      id: j.id,
      origin: 'callback-job',
      url: j.url,
      method: null,
      path: null,
      statusCode: normaliseStatusCode(j.delivered, j.lastError),
      errorMessage: normaliseError(j.delivered, j.lastError),
      responseBody: normaliseResponseBody(j.responseBody),
      payload: null,
      createdAt: j.createdAt,
      respondedAt: j.delivered ? j.updatedAt : null,
    })),
    ...deadLetters.map((d): NormalisedLog => ({
      id: d.id,
      origin: 'callback-dead-letter',
      url: d.url,
      method: null,
      path: null,
      statusCode: d.statusCode ?? null,
      errorMessage: d.errorMessage ?? null,
      responseBody: normaliseResponseBody(d.responseBody),
      payload: null,
      createdAt: d.createdAt,
      respondedAt: d.createdAt,
    })),
    ...requestLogs.map((r): NormalisedLog => ({
      id: r.id,
      origin: 'client-request',
      url: null,
      method: r.method,
      path: r.path,
      statusCode: r.statusCode,
      errorMessage: r.errorMessage ?? null,
      responseBody: r.responseBody ?? null,
      payload: normaliseResponseBody(r.payload),
      createdAt: r.createdAt,
      respondedAt: null,
    })),
  ]

  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  const filtered = merged.filter(row => applyStatusFilter(row, statusFilter))

  const rows = filtered.slice(skip, skip + pageSize)
  const total = filtered.length

  return res.json({ rows, total })
}

function normaliseResponseBody(body: unknown) {
  if (body == null) return null
  if (typeof body === 'string') return body
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

function normaliseStatusCode(delivered: boolean, lastError: unknown): number | null {
  if (delivered) return 200
  const status = (lastError as any)?.statusCode
  if (typeof status === 'number') return status
  return null
}

function normaliseError(delivered: boolean, lastError: unknown): string | null {
  if (delivered) return null
  const message = (lastError as any)?.message ?? (lastError as any)?.error
  if (typeof message === 'string') return message
  return null
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

type StatusFilter = 'success' | 'failure' | null

function parseStatusFilter(value: unknown): StatusFilter {
  if (typeof value !== 'string') return null
  if (value === 'true') return 'success'
  if (value === 'false') return 'failure'
  return null
}

function buildDateFilter(from?: Date, to?: Date) {
  const filter: { gte?: Date; lte?: Date } = {}
  if (from) filter.gte = from
  if (to) filter.lte = to
  return Object.keys(filter).length ? filter : null
}

function applyStatusFilter(log: NormalisedLog, filter: StatusFilter): boolean {
  if (!filter) return true
  if (log.statusCode == null) return filter === 'failure'
  if (filter === 'success') return log.statusCode >= 200 && log.statusCode < 400
  return log.statusCode >= 400
}
