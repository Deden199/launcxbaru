import { Response } from 'express';
import { z } from 'zod';

import { prisma } from '../../core/prisma';
import { AuthRequest } from '../../middleware/auth';
import { logAdminAction } from '../../util/adminLog';
import logger from '../../logger';
import { wibTimestamp } from '../../util/time';
import { ORDER_STATUS, LOAN_SETTLED_METADATA_REASON } from '../../types/orderStatus';
import { emitOrderEvent } from '../../util/orderEvents';
import {
  toStartOfDayWib,
  toEndOfDayWib,
  normalizeMetadata,
  LOAN_ADJUSTABLE_STATUSES,
  type LoanAdjustableStatus,
  applyLoanSettlementUpdates,
  runLoanSettlementByRange,
  revertLoanSettlementsByRange,
  type MarkSettledSummary,
  type OrderForLoanSettlement,
  type LoanSettlementUpdate,
  createLoanSettlementAuditEntry,
  createLoanEntrySnapshot,
  type LoanSettlementRevertSummary,
} from '../../service/loanSettlement';
import {
  startLoanSettlementJob as enqueueLoanSettlementJob,
  getLoanSettlementJob,
  type LoanSettlementJobStatus,
} from '../../worker/loanSettlementJob';

const MAX_CONFIGURED_PAGE_SIZE = 1500;
const configuredMaxPageSize = Number(process.env.LOAN_MAX_PAGE_SIZE);
const MAX_PAGE_SIZE =
  Number.isFinite(configuredMaxPageSize) && configuredMaxPageSize >= 1
    ? Math.min(configuredMaxPageSize, MAX_CONFIGURED_PAGE_SIZE)
    : MAX_CONFIGURED_PAGE_SIZE;
const DEFAULT_PAGE_SIZE = 50;

const loanQuerySchema = z.object({
  subMerchantId: z.string().min(1, 'subMerchantId is required'),
  startDate: z.string().min(1, 'startDate is required'),
  endDate: z.string().min(1, 'endDate is required'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).default(DEFAULT_PAGE_SIZE),
});

const markSettledBodySchema = z.object({
  orderIds: z.array(z.string().min(1)).nonempty('orderIds is required'),
  note: z.string().max(500).optional(),
});

const markSettledRangeSchema = z.object({
  subMerchantId: z.string().min(1, 'subMerchantId is required'),
  startDate: z.string().min(1, 'startDate is required'),
  endDate: z.string().min(1, 'endDate is required'),
  note: z.string().max(500).optional(),
  dryRun: z.boolean().optional(),
});

const revertSettledRangeSchema = z.object({
  subMerchantId: z.string().min(1, 'subMerchantId is required'),
  startDate: z.string().min(1, 'startDate is required'),
  endDate: z.string().min(1, 'endDate is required'),
  note: z.string().max(500).optional(),
  orderIds: z.array(z.string().min(1)).optional(),
  exportOnly: z.boolean().optional(),
});

const listLoanJobsQuerySchema = z.object({
  subMerchantId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function getLoanTransactions(req: AuthRequest, res: Response) {
  try {
    const { subMerchantId, startDate, endDate, page, pageSize } =
      loanQuerySchema.parse(req.query);

    const start = toStartOfDayWib(startDate);
    const end = toEndOfDayWib(endDate);

    const safePageSize = Math.min(pageSize, MAX_PAGE_SIZE);
    const skip = (page - 1) * safePageSize;
    const statusValues = [...LOAN_ADJUSTABLE_STATUSES, ORDER_STATUS.LN_SETTLED];
    const where = {
      subMerchantId,
      status: { in: statusValues },
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          pendingAmount: true,
          status: true,
          createdAt: true,
          isLoan: true,
          loanAmount: true,
          loanAt: true,
          loanBy: true,
          loanedAt: true,
          loanEntry: {
            select: {
              amount: true,
              createdAt: true,
            },
          },
        },
        take: safePageSize,
        skip,
      }),
      prisma.order.count({ where }),
    ]);

    const data = orders.map((order) => ({
      id: order.id,
      amount: order.amount,
      pendingAmount: order.pendingAmount ?? 0,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      isLoan: order.isLoan,
      loanedAt: order.loanedAt ? order.loanedAt.toISOString() : null,
      loanAt: order.loanAt ? order.loanAt.toISOString() : null,
      loanBy: order.loanBy ?? null,
      loanAmount: order.loanAmount ?? order.loanEntry?.amount ?? null,
      loanCreatedAt: order.loanAt
        ? order.loanAt.toISOString()
        : order.loanEntry?.createdAt
        ? order.loanEntry.createdAt.toISOString()
        : null,
    }));

    return res.json({
      data,
      meta: {
        total,
        page,
        pageSize: safePageSize,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    if (error instanceof Error && error.message.startsWith('Invalid ')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[getLoanTransactions]', error);
    return res.status(500).json({ error: 'Failed to fetch loan transactions' });
  }
}

export async function markLoanOrdersSettled(req: AuthRequest, res: Response) {
  try {
    const parsed = markSettledBodySchema.parse(req.body);
    const note = parsed.note?.trim() ? parsed.note.trim() : undefined;
    const orderIds = Array.from(new Set(parsed.orderIds));

    const orders = (await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        status: true,
        pendingAmount: true,
        settlementAmount: true,
        settlementStatus: true,
        settlementTime: true,
        metadata: true,
        subMerchantId: true,
        isLoan: true,
        loanAmount: true,
        loanAt: true,
        loanBy: true,
        loanedAt: true,
        createdAt: true,
        loanEntry: {
          select: {
            id: true,
            subMerchantId: true,
            amount: true,
            metadata: true,
          },
        },
      },
    })) as OrderForLoanSettlement[];

    const ordersById = new Map<string, OrderForLoanSettlement>(
      orders.map((order) => [order.id, order]),
    );
    const summary: MarkSettledSummary = { ok: [], fail: [], errors: [] };
    const updates: LoanSettlementUpdate[] = [];

    const now = wibTimestamp();
    const markedAtIso = now.toISOString();
    const adminId = req.userId ?? undefined;

    const isLoanAdjustableStatus = (status: string): status is LoanAdjustableStatus =>
      (LOAN_ADJUSTABLE_STATUSES as readonly string[]).includes(status);

    for (const id of orderIds) {
      const order = ordersById.get(id);
      if (!order) {
        summary.fail.push(id);
        summary.errors.push({ orderId: id, message: 'Order not found' });
        continue;
      }

      if (order.status === ORDER_STATUS.LN_SETTLED) {
        if (!summary.ok.includes(id)) {
          summary.ok.push(id);
        }
        continue;
      }

      if (!isLoanAdjustableStatus(order.status)) {
        summary.fail.push(id);
        summary.errors.push({
          orderId: id,
          message: `Order is in status ${order.status} and cannot be loan-settled`,
        });
        continue;
      }

      const metadata = normalizeMetadata(order.metadata);
      const auditEntry = createLoanSettlementAuditEntry({
        order,
        adminId,
        markedAtIso,
        note,
      });

      const historyKey = 'loanSettlementHistory';
      const history = Array.isArray(metadata[historyKey])
        ? [...metadata[historyKey], auditEntry]
        : [auditEntry];

      metadata[historyKey] = history;
      metadata.lastLoanSettlement = auditEntry;

      updates.push({
        id,
        subMerchantId: order.subMerchantId,
        metadata,
        pendingAmount: order.pendingAmount,
        originalStatus: order.status,
        settlementAmount: order.settlementAmount,
        previousLoanEntry: createLoanEntrySnapshot(order.loanEntry),
      });
    }

    if (updates.length === 0) {
      return res.json(summary);
    }

    const events = await applyLoanSettlementUpdates({
      updates,
      summary,
      adminId,
      note,
      now,
      markedAtIso,
    });

    if (adminId) {
      await logAdminAction(adminId, 'loanMarkSettled', undefined, {
        orderIds,
        ok: summary.ok,
        fail: summary.fail,
        note,
      });
    }

    for (const event of events) {
      emitOrderEvent('order.loan_settled', event);
    }

    return res.json(summary);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    console.error('[markLoanOrdersSettled]', error);
    return res.status(500).json({ error: 'Failed to mark loans as settled' });
  }
}

export async function markLoanOrdersSettledByRange(req: AuthRequest, res: Response) {
  try {
    const parsed = markSettledRangeSchema.parse(req.body);
    const summary = await runLoanSettlementByRange({
      subMerchantId: parsed.subMerchantId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      note: parsed.note,
      adminId: req.userId ?? undefined,
      dryRun: parsed.dryRun ?? false,
    });

    return res.json(summary);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    if (error instanceof Error && error.message.startsWith('Invalid ')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[markLoanOrdersSettledByRange]', error);
    return res.status(500).json({ error: 'Failed to mark loans as settled by range' });
  }
}

export async function revertLoanOrdersSettled(req: AuthRequest, res: Response) {
  try {
    const parsed = revertSettledRangeSchema.parse(req.body);
    const adminId = req.userId ?? undefined;

    const result = await revertLoanSettlementsByRange({
      subMerchantId: parsed.subMerchantId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      note: parsed.note,
      adminId,
      orderIds: parsed.orderIds,
      exportOnly: parsed.exportOnly,
    });

    const payload: LoanSettlementRevertSummary = {
      ok: result.ok,
      fail: result.fail,
      errors: result.errors,
      events: result.events,
      exportFile: result.exportFile,
    };

    return res.json(payload);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    if (error instanceof Error && error.message.startsWith('Invalid ')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[revertLoanOrdersSettled]', error);
    return res.status(500).json({ error: 'Failed to revert loan settlements' });
  }
}

export async function startLoanSettlementJob(req: AuthRequest, res: Response) {
  try {
    const parsed = markSettledRangeSchema.parse(req.body);
    const trimmedNote = parsed.note?.trim() ? parsed.note.trim() : undefined;
    const adminId = req.userId ?? undefined;

    const jobId = await enqueueLoanSettlementJob({
      subMerchantId: parsed.subMerchantId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      note: trimmedNote,
      adminId,
      dryRun: parsed.dryRun ?? false,
    });

    logger.info(
      `[LoanSettlementAdmin] queued job ${jobId} (${parsed.subMerchantId}) dryRun=${parsed.dryRun ?? false} range ${parsed.startDate} - ${parsed.endDate}`,
    );

    if (adminId) {
      await logAdminAction(adminId, 'loanMarkSettledRangeJobStart', undefined, {
        jobId,
        subMerchantId: parsed.subMerchantId,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        dryRun: parsed.dryRun ?? false,
      });
    }

    return res.status(202).json({ jobId });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    if (error instanceof Error && error.message.startsWith('Invalid ')) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('[startLoanSettlementJob]', error);
    return res.status(500).json({ error: 'Failed to queue loan settlement job' });
  }
}

export async function loanSettlementJobStatus(req: AuthRequest, res: Response) {
  try {
    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const [jobRecord, runtimeJob] = await Promise.all([
      prisma.loanSettlementJob.findUnique({
        where: { id: jobId },
      }),
      Promise.resolve(getLoanSettlementJob(jobId)),
    ]);

    if (!jobRecord) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const recordStatus = jobRecord.status as LoanSettlementJobStatus;
    const status = runtimeJob?.status ?? (recordStatus === 'pending' ? 'queued' : recordStatus);
    const summary = runtimeJob?.summary ?? { ok: [], fail: [], errors: [] };

    return res.json({
      jobId: jobRecord.id,
      status,
      summary,
      createdAt: jobRecord.createdAt.toISOString(),
      startedAt: runtimeJob?.startedAt ?? null,
      completedAt: runtimeJob?.completedAt ?? null,
      updatedAt: jobRecord.updatedAt.toISOString(),
      error: runtimeJob?.error ?? null,
      dryRun: jobRecord.dryRun,
      subMerchantId: jobRecord.subMerchantId,
      startDate: jobRecord.startDate.toISOString(),
      endDate: jobRecord.endDate.toISOString(),
      totals: {
        totalOrder: jobRecord.totalOrder,
        totalLoanAmount: jobRecord.totalLoanAmount,
      },
      createdBy: jobRecord.createdBy ?? null,
    });
  } catch (error) {
    logger.error('[loanSettlementJobStatus]', error);
    return res.status(500).json({ error: 'Failed to fetch loan settlement job status' });
  }
}

export async function listLoanSettlementJobs(req: AuthRequest, res: Response) {
  try {
    const parsed = listLoanJobsQuerySchema.parse(req.query);
    const { subMerchantId, status, limit } = parsed;

    const jobs = await prisma.loanSettlementJob.findMany({
      where: {
        ...(subMerchantId ? { subMerchantId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return res.json({
      data: jobs.map(job => ({
        id: job.id,
        status: job.status,
        dryRun: job.dryRun,
        subMerchantId: job.subMerchantId,
        startDate: job.startDate.toISOString(),
        endDate: job.endDate.toISOString(),
        totalOrder: job.totalOrder,
        totalLoanAmount: job.totalLoanAmount,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        createdBy: job.createdBy ?? null,
        createdByName: job.creator?.name ?? null,
      })),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    logger.error('[listLoanSettlementJobs]', error);
    return res.status(500).json({ error: 'Failed to fetch loan settlement jobs' });
  }
}
