import { Response } from 'express'
import { z } from 'zod'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../core/prisma'
import {
  runManualSettlement,
  resetSettlementState,
  restartSettlementChecker,
  MANUAL_SETTLEMENT_BATCH_SIZE,
} from '../../cron/settlement'
import { AuthRequest } from '../../middleware/auth'
import { logAdminAction } from '../../util/adminLog'
import {
  startSettlementJob,
  getSettlementJob,
  cancelSettlementJob,
  type StartSettlementJobOptions,
} from '../../worker/settlementJob'
import { computeSettlement } from '../../service/feeSettlement'
import type { ManualSettlementFilters, ManualSettlementPreview, ManualSettlementPreviewOrder } from '../../types/manualSettlement'

const JAKARTA_TZ = 'Asia/Jakarta'
const PREVIEW_FETCH_SIZE = 500
const PREVIEW_SAMPLE_LIMIT = 20

const parseStringArray = (input: unknown): string[] => {
  if (Array.isArray(input)) {
    return input
      .map(v => String(v).trim())
      .filter(Boolean)
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  }
  return []
}

const settlementFilterSchema = z.object({
  dateFrom: z.string().min(1, 'dateFrom is required'),
  dateTo: z.string().min(1, 'dateTo is required'),
  daysOfWeek: z
    .preprocess(input => {
      if (Array.isArray(input)) {
        return input.map(v => Number(v))
      }
      if (typeof input === 'string') {
        return input
          .split(',')
          .map(v => Number(v.trim()))
          .filter(n => !Number.isNaN(n))
      }
      return []
    }, z.array(z.number().int().min(0).max(6)).nonempty('daysOfWeek is required')),
  hourStart: z.coerce.number().int().min(0).max(23),
  hourEnd: z.coerce.number().int().min(0).max(23),
  clientIds: z
    .preprocess(input => parseStringArray(input), z.array(z.string().min(1)).optional())
    .optional(),
  clientMode: z.enum(['include', 'exclude']).optional(),
  subMerchantIds: z
    .preprocess(input => parseStringArray(input), z.array(z.string().min(1)).optional())
    .optional(),
  subMerchantMode: z.enum(['include', 'exclude']).optional(),
  paymentMethods: z
    .preprocess(input => parseStringArray(input), z.array(z.string().min(1)).optional())
    .optional(),
  paymentMode: z.enum(['include', 'exclude']).optional(),
  minAmount: z
    .preprocess(input => {
      if (input === '' || input === null || input === undefined) {
        return undefined
      }
      const num = Number(input)
      return Number.isFinite(num) ? num : undefined
    }, z.number().nonnegative().optional())
    .optional(),
  maxAmount: z
    .preprocess(input => {
      if (input === '' || input === null || input === undefined) {
        return undefined
      }
      const num = Number(input)
      return Number.isFinite(num) ? num : undefined
    }, z.number().nonnegative().optional())
    .optional(),
  includeZeroAmount: z
    .preprocess(input => {
      if (input === '' || input === null || input === undefined) {
        return undefined
      }
      if (typeof input === 'boolean') {
        return input
      }
      if (typeof input === 'string') {
        return input === 'true' || input === '1'
      }
      return undefined
    }, z.boolean().optional())
    .optional(),
})

type SettlementFilterInput = z.infer<typeof settlementFilterSchema>

type PreviewQueryOrder = {
  id: string
  partnerClientId: string | null
  subMerchantId: string | null
  pendingAmount: number | null
  amount: number
  channel: string
  createdAt: Date
  partnerClient: { feePercent: number | null; feeFlat: number | null } | null
}

const resolveFilterPayload = (body: any): unknown => {
  if (body && typeof body === 'object' && 'filters' in body) {
    return (body as Record<string, unknown>).filters
  }
  return body
}

const buildFilters = (input: unknown): ManualSettlementFilters => {
  const parsed = settlementFilterSchema.parse(input) as SettlementFilterInput

  const startDate = fromZonedTime(`${parsed.dateFrom}T00:00:00`, JAKARTA_TZ)
  const endDate = fromZonedTime(`${parsed.dateTo}T23:59:59.999`, JAKARTA_TZ)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid date range')
  }

  if (startDate > endDate) {
    throw new Error('dateFrom must be before or equal to dateTo')
  }

  if (parsed.hourStart > parsed.hourEnd) {
    throw new Error('hourStart must be before or equal to hourEnd')
  }

  if (
    parsed.minAmount != null &&
    parsed.maxAmount != null &&
    parsed.minAmount > parsed.maxAmount
  ) {
    throw new Error('minAmount cannot be greater than maxAmount')
  }

  const days = Array.from(new Set(parsed.daysOfWeek)).sort()

  return {
    timezone: JAKARTA_TZ,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    startDate,
    endDate,
    daysOfWeek: days,
    hourStart: parsed.hourStart,
    hourEnd: parsed.hourEnd,
    clientIds: (parsed.clientIds ?? []).map(v => v.trim()).filter(Boolean),
    clientMode: parsed.clientMode ?? 'include',
    subMerchantIds: (parsed.subMerchantIds ?? []).map(v => v.trim()).filter(Boolean),
    subMerchantMode: parsed.subMerchantMode ?? 'include',
    paymentMethods: (parsed.paymentMethods ?? []).map(v => v.trim()).filter(Boolean),
    paymentMode: parsed.paymentMode ?? 'include',
    minAmount: parsed.minAmount ?? null,
    maxAmount: parsed.maxAmount ?? null,
    includeZeroAmount: parsed.includeZeroAmount ?? false,
  }
}

const buildOrderWhere = (filters: ManualSettlementFilters): Prisma.OrderWhereInput => {
  const where: Prisma.OrderWhereInput = {
    status: 'PAID',
    partnerClientId:
      filters.clientIds.length > 0
        ? filters.clientMode === 'exclude'
          ? { notIn: filters.clientIds, not: null }
          : { in: filters.clientIds }
        : { not: null },
    createdAt: {
      gte: filters.startDate,
      lte: filters.endDate,
    },
  }

  if (filters.subMerchantIds.length > 0) {
    where.subMerchantId =
      filters.subMerchantMode === 'exclude'
        ? { notIn: filters.subMerchantIds }
        : { in: filters.subMerchantIds }
  }

  if (filters.paymentMethods.length > 0) {
    where.channel =
      filters.paymentMode === 'exclude'
        ? { notIn: filters.paymentMethods }
        : { in: filters.paymentMethods }
  }

  return where
}

const isWithinDayHour = (date: Date, filters: ManualSettlementFilters) => {
  const local = toZonedTime(date, filters.timezone)
  const day = local.getDay()
  if (!filters.daysOfWeek.includes(day)) {
    return false
  }
  const hour = local.getHours()
  return hour >= filters.hourStart && hour <= filters.hourEnd
}

const amountMatchesFilters = (amount: number, filters: ManualSettlementFilters) => {
  if (!Number.isFinite(amount)) {
    return false
  }
  if (filters.minAmount != null && amount < filters.minAmount) {
    return false
  }
  if (filters.maxAmount != null && amount > filters.maxAmount) {
    return false
  }
  if (!filters.includeZeroAmount && amount <= 0) {
    return false
  }
  return true
}

const computeManualNetAmount = (order: PreviewQueryOrder): number | null => {
  let net = Number(order.pendingAmount ?? 0)
  if (!Number.isFinite(net) || net <= 0) {
    const gross = Number(order.amount ?? 0)
    if (!Number.isFinite(gross) || gross <= 0) {
      return null
    }
    const percent = order.partnerClient?.feePercent ?? 0
    const flat = order.partnerClient?.feeFlat ?? 0
    const computed = computeSettlement(gross, { percent, flat })
    net = computed.settlement
  }

  if (!Number.isFinite(net) || net <= 0) {
    return null
  }

  return net
}

const buildSettlementPreview = async (
  filters: ManualSettlementFilters,
): Promise<ManualSettlementPreview> => {
  const baseWhere = buildOrderWhere(filters)
  const sample: ManualSettlementPreviewOrder[] = []
  const batchSize = MANUAL_SETTLEMENT_BATCH_SIZE

  let cursor: { createdAt: Date; id: string } | null = null
  let totalOrders = 0
  let totalNetAmount = 0

  while (true) {
    const where: Prisma.OrderWhereInput = {
      ...baseWhere,
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: PREVIEW_FETCH_SIZE,
      select: {
        id: true,
        partnerClientId: true,
        subMerchantId: true,
        pendingAmount: true,
        amount: true,
        channel: true,
        createdAt: true,
        partnerClient: { select: { feePercent: true, feeFlat: true } },
      },
    })

    if (!orders.length) {
      break
    }

    for (const order of orders) {
      if (!isWithinDayHour(order.createdAt, filters)) {
        continue
      }
      const net = computeManualNetAmount(order as PreviewQueryOrder)
      if (net == null) {
        continue
      }
      if (!amountMatchesFilters(net, filters)) {
        continue
      }

      totalOrders += 1
      totalNetAmount += net

      if (sample.length < PREVIEW_SAMPLE_LIMIT) {
        const local = toZonedTime(order.createdAt, filters.timezone)
        sample.push({
          id: order.id,
          partnerClientId: order.partnerClientId ?? null,
          subMerchantId: order.subMerchantId ?? null,
          channel: order.channel,
          amount: order.amount ?? 0,
          pendingAmount: order.pendingAmount ?? null,
          netAmount: net,
          createdAt: local.toISOString(),
        })
      }
    }

    if (orders.length < PREVIEW_FETCH_SIZE) {
      break
    }

    const last = orders[orders.length - 1]
    cursor = { createdAt: last.createdAt, id: last.id }
  }

  const estimatedBatches = totalOrders ? Math.ceil(totalOrders / batchSize) : 0

  return {
    totalOrders,
    totalNetAmount,
    batchSize,
    estimatedBatches,
    sample,
  }
}

export async function manualSettlement(req: AuthRequest, res: Response) {
  resetSettlementState()
  const result = await runManualSettlement()
  restartSettlementChecker('')
  if (req.userId) {
    await logAdminAction(req.userId, 'manualSettlement', null, result)
  }
  res.json({ data: result })
}

export async function previewSettlement(req: AuthRequest, res: Response) {
  try {
    const filters = buildFilters(resolveFilterPayload(req.body))
    const preview = await buildSettlementPreview(filters)
    res.json({ data: { filters, preview } })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' })
    }
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message })
    }
    return res.status(500).json({ error: 'Failed to build preview' })
  }
}

export async function startSettlement(req: AuthRequest, res: Response) {
  try {
    const filters = buildFilters(resolveFilterPayload(req.body))
    const options: StartSettlementJobOptions = {
      filters,
      createdBy: req.userId ?? undefined,
    }
    const jobId = startSettlementJob(options)
    if (req.userId) {
      await logAdminAction(req.userId, 'manualSettlementStart', null, { jobId, filters })
    }
    res.json({ data: { jobId } })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' })
    }
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message })
    }
    return res.status(500).json({ error: 'Failed to start settlement job' })
  }
}

export function settlementStatus(req: AuthRequest, res: Response) {
  const job = getSettlementJob(req.params.jobId)
  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }
  const { settledOrders, netAmount, status, error, batches, filters, createdAt, updatedAt, cancelled, preview } = job
  res.json({
    data: {
      settledOrders,
      netAmount,
      status,
      error: error ?? null,
      batches,
      filters,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      cancelled: cancelled ?? false,
      preview: preview ?? null,
    },
  })
}

export function cancelSettlement(req: AuthRequest, res: Response) {
  const cancelled = cancelSettlementJob(req.params.jobId)
  if (!cancelled) {
    return res.status(400).json({ error: 'Unable to cancel job' })
  }
  res.json({ data: { cancelled: true } })
}

export async function downloadSettlementSummary(req: AuthRequest, res: Response) {
  const { jobId } = req.params
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' })
  }

  const logEntry = await prisma.adminLog.findFirst({
    where: {
      action: {
        in: [
          'manualSettlementJobCompleted',
          'manualSettlementJobFailed',
          'manualSettlementJobCancelled',
        ],
      },
      target: jobId,
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!logEntry) {
    return res.status(404).json({ error: 'Summary not found' })
  }

  res.json({
    data: {
      id: logEntry.id,
      createdAt: logEntry.createdAt.toISOString(),
      detail: logEntry.detail ?? null,
    },
  })
}
