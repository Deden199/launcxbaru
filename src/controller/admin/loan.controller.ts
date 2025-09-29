import { Response } from 'express';
import { z } from 'zod';
import moment from 'moment-timezone';

import { prisma } from '../../core/prisma';
import { AuthRequest } from '../../middleware/auth';
import { logAdminAction } from '../../util/adminLog';
import { wibTimestamp } from '../../util/time';
import { ORDER_STATUS, LOAN_SETTLED_METADATA_REASON } from '../../types/orderStatus';
import { emitOrderEvent } from '../../util/orderEvents';

const MAX_CONFIGURED_PAGE_SIZE = 1500;
const configuredMaxPageSize = Number(process.env.LOAN_MAX_PAGE_SIZE);
const MAX_PAGE_SIZE =
  Number.isFinite(configuredMaxPageSize) && configuredMaxPageSize >= 1
    ? Math.min(configuredMaxPageSize, MAX_CONFIGURED_PAGE_SIZE)
    : MAX_CONFIGURED_PAGE_SIZE;
const DEFAULT_PAGE_SIZE = 50;

const DEFAULT_LOAN_CHUNK_SIZE = 25;
const configuredLoanChunkSize = Number(process.env.LOAN_CREATE_MANY_CHUNK_SIZE);
const LOAN_CREATE_MANY_CHUNK_SIZE =
  Number.isFinite(configuredLoanChunkSize) && configuredLoanChunkSize >= 1
    ? Math.floor(configuredLoanChunkSize)
    : DEFAULT_LOAN_CHUNK_SIZE;

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

const toStartOfDayWib = (value: string) => {
  const date = moment.tz(value, 'Asia/Jakarta');
  if (!date.isValid()) {
    throw new Error('Invalid startDate');
  }
  return date.startOf('day').toDate();
};

const toEndOfDayWib = (value: string) => {
  const date = moment.tz(value, 'Asia/Jakarta');
  if (!date.isValid()) {
    throw new Error('Invalid endDate');
  }
  return date.endOf('day').toDate();
};

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

function normalizeMetadata(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, any>) };
  }
  return {};
}

type MarkSettledSummary = {
  ok: string[];
  fail: string[];
  errors: { orderId: string; message: string }[];
};

type LoanSettlementEventPayload = {
  orderId: string;
  previousStatus: string;
  adminId?: string;
  markedAt: string;
  note?: string;
};

type OrderForLoanSettlement = {
  id: string;
  status: string;
  pendingAmount: number | null | undefined;
  settlementAmount: number | null | undefined;
  settlementStatus: string | null | undefined;
  metadata: unknown;
  subMerchantId: string | null | undefined;
  loanedAt: Date | null;
};

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
    const updates: {
      id: string;
      subMerchantId?: string | null;
      metadata: Record<string, any>;
      pendingAmount: number | null | undefined;
    }[] = [];

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

    const configuredTimeout = Number(process.env.LOAN_TRANSACTION_TIMEOUT);
    const transactionTimeout =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 20000;

    const events: LoanSettlementEventPayload[] = [];

    await prisma.$transaction(
      async (tx) => {
        const chunkSize = Math.max(1, LOAN_CREATE_MANY_CHUNK_SIZE);
        for (let start = 0; start < updates.length; start += chunkSize) {
          const chunk = updates.slice(start, start + chunkSize);

          await Promise.all(
            chunk.map(async (update) => {
              try {
                const result = await tx.order.updateMany({
                  where: { id: update.id, status: ORDER_STATUS.PAID },
                  data: {
                    status: ORDER_STATUS.LN_SETTLED,
                    pendingAmount: null,
                    settlementStatus: null,
                    loanedAt: now,
                    metadata: update.metadata,
                  },
                });

                if (result.count === 0) {
                  if (!summary.fail.includes(update.id)) {
                    summary.fail.push(update.id);
                  }
                  summary.errors.push({
                    orderId: update.id,
                    message: 'Order status changed before loan settlement could be applied',
                  });
                  return;
                }

                if (!summary.ok.includes(update.id)) {
                  summary.ok.push(update.id);
                }

                const amount = Number(update.pendingAmount ?? 0);
                if (amount > 0 && update.subMerchantId) {
                  await tx.loanEntry.upsert({
                    where: { orderId: update.id },
                    create: {
                      orderId: update.id,
                      subMerchantId: update.subMerchantId,
                      amount,
                      metadata: {
                        reason: LOAN_SETTLED_METADATA_REASON,
                        markedAt: markedAtIso,
                        ...(adminId ? { markedBy: adminId } : {}),
                        ...(note ? { note } : {}),
                      },
                    },
                    update: {
                      amount,
                      metadata: {
                        reason: LOAN_SETTLED_METADATA_REASON,
                        markedAt: markedAtIso,
                        ...(adminId ? { markedBy: adminId } : {}),
                        ...(note ? { note } : {}),
                      },
                    },
                  });
                }

                events.push({
                  orderId: update.id,
                  previousStatus: ORDER_STATUS.PAID,
                  adminId,
                  markedAt: markedAtIso,
                  note,
                });
              } catch (error: any) {
                if (!summary.fail.includes(update.id)) {
                  summary.fail.push(update.id);
                }
                const message =
                  error instanceof Error && error.message
                    ? error.message
                    : 'Failed to mark order as loan-settled';
                summary.errors.push({ orderId: update.id, message });
              }
            }),
          );
        }
      },
      { timeout: transactionTimeout },
    );

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
