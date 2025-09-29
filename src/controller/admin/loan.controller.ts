import { Response } from 'express';
import { z } from 'zod';
import moment from 'moment-timezone';

import { prisma } from '../../core/prisma';
import { AuthRequest } from '../../middleware/auth';
import { logAdminAction } from '../../util/adminLog';
import { wibTimestamp } from '../../util/time';

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
  includeSettled: z.coerce.boolean().optional().default(false),
});

const settleBodySchema = z.object({
  subMerchantId: z.string().min(1, 'subMerchantId is required'),
  orderIds: z.array(z.string().min(1)).nonempty('orderIds is required'),
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
    const { subMerchantId, startDate, endDate, page, pageSize, includeSettled } =
      loanQuerySchema.parse(req.query);

    const start = toStartOfDayWib(startDate);
    const end = toEndOfDayWib(endDate);

    const safePageSize = Math.min(pageSize, MAX_PAGE_SIZE);
    const skip = (page - 1) * safePageSize;
    const statusValues = includeSettled ? ['PAID', 'LN_SETTLE'] : ['PAID'];
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

class OrderSettlementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderSettlementConflictError';
  }
}

export async function settleLoanOrders(req: AuthRequest, res: Response) {
  try {
    const { subMerchantId, orderIds } = settleBodySchema.parse(req.body);

    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        subMerchantId,
        status: 'PAID',
      },
      select: {
        id: true,
        pendingAmount: true,
        subMerchantId: true,
      },
    });

    if (orders.length !== orderIds.length) {
      return res.status(400).json({
        error: 'Some orders were not found or not in PAID status',
      });
    }

    const now = wibTimestamp();
    const settledBy = req.userId ?? 'unknown';

    const loanEntries = orders.map((order) => {
      const amount = Number(order.pendingAmount ?? 0);
      return {
        orderId: order.id,
        subMerchantId: order.subMerchantId!,
        amount,
        metadata: {
          settledBy,
          settledAt: now.toISOString(),
        },
      };
    });

    const totalAmount = loanEntries.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);

    const configuredChunkSize = Number(process.env.LOAN_CREATE_MANY_CHUNK_SIZE);
    const CREATE_MANY_CHUNK_SIZE =
      Number.isFinite(configuredChunkSize) && configuredChunkSize > 0 ? configuredChunkSize : 1000;

    const configuredTimeout = Number(process.env.LOAN_TRANSACTION_TIMEOUT);
    const transactionTimeout =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 20000;

    let processedCount = 0;
    await prisma.$transaction(
      async (tx) => {
        const updateResult = await tx.order.updateMany({
          where: { id: { in: orderIds }, subMerchantId, status: 'PAID' },
          data: {
            status: 'LN_SETTLE',
            pendingAmount: 0,
            loanedAt: now,
          },
        });

        processedCount = updateResult.count;
        if (updateResult.count !== orderIds.length) {
          throw new OrderSettlementConflictError(
            'Some orders were updated by another process. Please retry.',
          );
        }

        if (loanEntries.length > 0) {
          for (let i = 0; i < loanEntries.length; i += CREATE_MANY_CHUNK_SIZE) {
            const chunk = loanEntries.slice(i, i + CREATE_MANY_CHUNK_SIZE);
            await tx.loanEntry.createMany({ data: chunk });
          }
        }
      },
      { timeout: transactionTimeout },
    );

    if (req.userId) {
      await logAdminAction(req.userId, 'loanSettle', subMerchantId, {
        orderIds,
        processed: processedCount,
        totalAmount,
      });
    }

    return res.json({ processed: processedCount, totalAmount });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    if (error instanceof OrderSettlementConflictError) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[settleLoanOrders]', error);
    return res.status(500).json({ error: 'Failed to settle loans' });
  }
}
