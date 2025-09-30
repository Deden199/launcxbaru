import { Response } from 'express';
import { z } from 'zod';

import { prisma } from '../../core/prisma';
import { AuthRequest } from '../../middleware/auth';
import { logAdminAction } from '../../util/adminLog';
import { wibTimestamp } from '../../util/time';
import { ORDER_STATUS, LOAN_SETTLED_METADATA_REASON } from '../../types/orderStatus';
import { emitOrderEvent } from '../../util/orderEvents';
import {
  toStartOfDayWib,
  toEndOfDayWib,
  normalizeMetadata,
  applyLoanSettlementUpdates,
  runLoanSettlementByRange,
  type MarkSettledSummary,
  type OrderForLoanSettlement,
  type LoanSettlementUpdate,
} from '../../service/loanSettlement';
import {
  startLoanSettlementJob as enqueueLoanSettlementJob,
  getLoanSettlementJob,
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
});

export async function getLoanTransactions(req: AuthRequest, res: Response) {
  try {
    const { subMerchantId, startDate, endDate, page, pageSize } =
      loanQuerySchema.parse(req.query);

    const start = toStartOfDayWib(startDate);
    const end = toEndOfDayWib(endDate);

    const safePageSize = Math.min(pageSize, MAX_PAGE_SIZE);
    const skip = (page - 1) * safePageSize;
    const statusValues = [ORDER_STATUS.PAID, ORDER_STATUS.LN_SETTLED];
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
      loanedAt: order.loanedAt ? order.loanedAt.toISOString() : null,
      loanAmount: order.loanEntry?.amount ?? null,
      loanCreatedAt: order.loanEntry?.createdAt
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
        metadata: true,
        subMerchantId: true,
        loanedAt: true,
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

      if (order.status !== ORDER_STATUS.PAID) {
        summary.fail.push(id);
        summary.errors.push({
          orderId: id,
          message: `Order is in status ${order.status} and cannot be loan-settled`,
        });
        continue;
      }

      const metadata = normalizeMetadata(order.metadata);
      const auditEntry = {
        reason: LOAN_SETTLED_METADATA_REASON,
        previousStatus: ORDER_STATUS.PAID,
        markedBy: adminId ?? 'unknown',
        markedAt: markedAtIso,
        ...(note ? { note } : {}),
      };

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

export async function startLoanSettlementJob(req: AuthRequest, res: Response) {
  try {
    const parsed = markSettledRangeSchema.parse(req.body);
    const jobId = enqueueLoanSettlementJob({
      subMerchantId: parsed.subMerchantId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      note: parsed.note,
      adminId: req.userId ?? undefined,
    });

    return res.status(202).json({ jobId });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    if (error instanceof Error && error.message.startsWith('Invalid ')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[startLoanSettlementJob]', error);
    return res.status(500).json({ error: 'Failed to queue loan settlement job' });
  }
}

export function loanSettlementJobStatus(req: AuthRequest, res: Response) {
  try {
    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const job = getLoanSettlementJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json({
      jobId: job.id,
      status: job.status,
      summary: job.summary,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      updatedAt: job.updatedAt,
      error: job.error ?? null,
    });
  } catch (error) {
    console.error('[loanSettlementJobStatus]', error);
    return res.status(500).json({ error: 'Failed to fetch loan settlement job status' });
  }
}
