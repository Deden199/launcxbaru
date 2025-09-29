import './helpers/testEnv'

import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

const prisma: any = {
  order: {
    findMany: async () => [],
    count: async () => 0,
    updateMany: async (_args: any) => ({}),
  },
  loanEntry: {
    upsert: async (_args: any) => ({}),
  },
  $transaction: async (cb: any, options?: any) => {
    prisma.__transactionOptions.push(options);
    prisma.__transactionCallCount += 1;
    return cb({
      loanEntry: prisma.loanEntry,
      order: {
        updateMany: prisma.order.updateMany,
      },
    });
  },
  __transactionOptions: [] as any[],
  __transactionCallCount: 0,
};

const resetTransactionTracking = () => {
  prisma.__transactionOptions = [];
  prisma.__transactionCallCount = 0;
};

process.env.LOAN_CREATE_MANY_CHUNK_SIZE = '2';

(require as any).cache[require.resolve('../src/core/prisma')] = {
  exports: { prisma },
};

const time = require('../src/util/time');
time.wibTimestamp = () => new Date('2024-01-01T00:00:00.000Z');

const adminLog = require('../src/util/adminLog');
let loggedAction: any = null;
adminLog.logAdminAction = async (...args: any[]) => {
  loggedAction = args;
};

const {
  getLoanTransactions,
  markLoanOrdersSettled,
  markLoanOrdersSettledByRange,
} = require('../src/controller/admin/loan.controller');

test('getLoanTransactions returns PAID and LN_SETTLED orders', async () => {
  const orders = [
    {
      id: 'ord-1',
      amount: 500,
      pendingAmount: 0,
      status: 'LN_SETTLED',
      createdAt: new Date('2024-05-02T03:00:00.000Z'),
      loanedAt: new Date('2024-05-02T04:00:00.000Z'),
      loanEntry: { amount: 500, createdAt: new Date('2024-05-02T04:00:00.000Z') },
    },
    {
      id: 'ord-2',
      amount: 250,
      pendingAmount: 250,
      status: 'PAID',
      createdAt: new Date('2024-05-02T05:00:00.000Z'),
      loanedAt: null,
      loanEntry: null,
    },
  ];

  let receivedFindManyArgs: any;
  let receivedCountArgs: any;
  prisma.order.findMany = async (args: any) => {
    receivedFindManyArgs = args;
    return orders;
  };
  prisma.order.count = async (args: any) => {
    receivedCountArgs = args;
    return 42;
  };

  const app = express();
  app.get('/admin/merchants/loan/transactions', (req, res) =>
    getLoanTransactions(req as any, res),
  );

  const res = await request(app)
    .get('/admin/merchants/loan/transactions')
    .query({
      subMerchantId: 'sub-1',
      startDate: '2024-05-01',
      endDate: '2024-05-03',
    });

  assert.equal(res.status, 200);
  assert.ok(receivedFindManyArgs);
  assert.equal(receivedFindManyArgs.where.subMerchantId, 'sub-1');
  assert.deepEqual(receivedFindManyArgs.where.status, { in: ['PAID', 'LN_SETTLED'] });
  assert.equal(
    receivedFindManyArgs.where.createdAt.gte.toISOString(),
    '2024-04-30T17:00:00.000Z',
  );
  assert.equal(
    receivedFindManyArgs.where.createdAt.lte.toISOString(),
    '2024-05-03T16:59:59.999Z',
  );
  assert.equal(receivedFindManyArgs.take, 50);
  assert.equal(receivedFindManyArgs.skip, 0);
  assert.deepEqual(receivedCountArgs, { where: receivedFindManyArgs.where });
  assert.deepEqual(res.body, {
    data: [
      {
        id: 'ord-1',
        amount: 500,
        pendingAmount: 0,
        status: 'LN_SETTLED',
        createdAt: '2024-05-02T03:00:00.000Z',
        loanedAt: '2024-05-02T04:00:00.000Z',
        loanAmount: 500,
        loanCreatedAt: '2024-05-02T04:00:00.000Z',
      },
      {
        id: 'ord-2',
        amount: 250,
        pendingAmount: 250,
        status: 'PAID',
        createdAt: '2024-05-02T05:00:00.000Z',
        loanedAt: null,
        loanAmount: null,
        loanCreatedAt: null,
      },
    ],
    meta: {
      total: 42,
      page: 1,
      pageSize: 50,
    },
  });
});

test('getLoanTransactions enforces maximum page size', async () => {
  prisma.order.findMany = async (args: any) => {
    assert.equal(args.take, 1500);
    assert.equal(args.skip, 1500);
    return [];
  };
  prisma.order.count = async (args: any) => {
    assert.equal(args.where.subMerchantId, 'sub-9');
    return 0;
  };

  const app = express();
  app.get('/admin/merchants/loan/transactions', (req, res) =>
    getLoanTransactions(req as any, res),
  );

  const res = await request(app)
    .get('/admin/merchants/loan/transactions')
    .query({
      subMerchantId: 'sub-9',
      startDate: '2024-05-01',
      endDate: '2024-05-03',
      page: 2,
      pageSize: 5000,
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.meta, {
    total: 0,
    page: 2,
    pageSize: 1500,
  });
});

test('markLoanOrdersSettled updates PAID orders and returns summary', async () => {
  loggedAction = null;
  resetTransactionTracking();
  const orderIds = ['ord-paid-1', 'ord-settled', 'ord-failed', 'ord-missing', 'ord-paid-2'];
  const fetchedOrders = [
    {
      id: 'ord-paid-1',
      status: 'PAID',
      pendingAmount: 150,
      settlementAmount: null,
      settlementStatus: 'PENDING',
      subMerchantId: 'sub-1',
      metadata: { loanSettlementHistory: [] },
      loanedAt: null,
    },
    {
      id: 'ord-settled',
      status: 'LN_SETTLED',
      pendingAmount: null,
      settlementAmount: null,
      settlementStatus: null,
      subMerchantId: 'sub-1',
      metadata: {},
      loanedAt: new Date('2023-12-31T00:00:00Z'),
    },
    {
      id: 'ord-failed',
      status: 'FAILED',
      pendingAmount: 10,
      settlementAmount: null,
      settlementStatus: null,
      subMerchantId: 'sub-2',
      metadata: null,
      loanedAt: null,
    },
    {
      id: 'ord-paid-2',
      status: 'PAID',
      pendingAmount: 0,
      settlementAmount: null,
      settlementStatus: null,
      subMerchantId: 'sub-1',
      metadata: null,
      loanedAt: null,
    },
  ];

  prisma.order.findMany = async () => fetchedOrders;

  const updateCalls: any[] = [];
  prisma.order.updateMany = async (args: any) => {
    updateCalls.push(args);
    return { count: 1 };
  };

  const upsertCalls: any[] = [];
  prisma.loanEntry.upsert = async (args: any) => {
    upsertCalls.push(args);
    return {};
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 'admin-123';
    next();
  });
  app.post('/admin/merchants/loan/mark-settled', (req, res) => {
    markLoanOrdersSettled(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/mark-settled')
    .send({ orderIds, note: 'Manual adjust' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.ok.sort(), ['ord-paid-1', 'ord-paid-2', 'ord-settled'].sort());
  assert.deepEqual(res.body.fail.sort(), ['ord-failed', 'ord-missing'].sort());
  assert.equal(res.body.errors.length, 2);

  assert.equal(prisma.__transactionCallCount, 1);
  assert.equal(prisma.__transactionOptions.length, 1);
  assert.deepEqual(prisma.__transactionOptions[0], { timeout: 20000 });

  assert.equal(updateCalls.length, 2);
  assert.deepEqual(updateCalls.map(call => call.where.id).sort(), ['ord-paid-1', 'ord-paid-2'].sort());
  for (const call of updateCalls) {
    assert.equal(call.data.status, 'LN_SETTLED');
    assert.equal(call.data.pendingAmount, null);
    assert.equal(call.data.settlementStatus, null);
    assert.deepEqual(call.data.metadata.lastLoanSettlement.reason, 'loan_adjustment');
    assert.equal(call.data.metadata.lastLoanSettlement.note, 'Manual adjust');
  }

  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].create.orderId, 'ord-paid-1');
  assert.equal(upsertCalls[0].create.metadata.note, 'Manual adjust');

  assert.ok(loggedAction);
  assert.equal(loggedAction[0], 'admin-123');
  assert.equal(loggedAction[1], 'loanMarkSettled');
  assert.deepEqual(loggedAction[3].ok.sort(), ['ord-paid-1', 'ord-paid-2', 'ord-settled'].sort());
});

test('markLoanOrdersSettled processes batches larger than the chunk size', async () => {
  loggedAction = null;
  resetTransactionTracking();
  const orderIds = ['ord-1', 'ord-2', 'ord-3', 'ord-4', 'ord-5'];
  const fetchedOrders = orderIds.map((id, index) => ({
    id,
    status: 'PAID',
    pendingAmount: index % 2 === 0 ? 500 : 0,
    settlementAmount: null,
    settlementStatus: 'PENDING',
    subMerchantId: 'sub-123',
    metadata: {},
    loanedAt: null,
  }));

  prisma.order.findMany = async () => fetchedOrders;

  const updateCalls: any[] = [];
  prisma.order.updateMany = async (args: any) => {
    updateCalls.push(args);
    return { count: 1 };
  };

  const upsertCalls: any[] = [];
  prisma.loanEntry.upsert = async (args: any) => {
    upsertCalls.push(args);
    return {};
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 'admin-999';
    next();
  });
  app.post('/admin/merchants/loan/mark-settled', (req, res) => {
    markLoanOrdersSettled(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/mark-settled')
    .send({ orderIds, note: 'Bulk adjustment' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.ok.sort(), orderIds.slice().sort());
  assert.deepEqual(res.body.fail, []);
  assert.equal(res.body.errors.length, 0);

  const chunkSize = Number(process.env.LOAN_CREATE_MANY_CHUNK_SIZE ?? '1');
  assert.equal(
    prisma.__transactionCallCount,
    Math.ceil(orderIds.length / Math.max(1, chunkSize)),
  );
  assert.equal(prisma.__transactionOptions.length, prisma.__transactionCallCount);
  for (const opt of prisma.__transactionOptions) {
    assert.deepEqual(opt, { timeout: 20000 });
  }

  assert.equal(updateCalls.length, orderIds.length);
  const seenIds = updateCalls.map((call) => call.where.id).sort();
  assert.deepEqual(seenIds, orderIds.slice().sort());
  for (const call of updateCalls) {
    assert.equal(call.where.status, 'PAID');
    assert.equal(call.data.status, 'LN_SETTLED');
    assert.equal(call.data.pendingAmount, null);
    assert.equal(call.data.settlementStatus, null);
    assert.equal(call.data.loanedAt.toISOString(), '2024-01-01T00:00:00.000Z');
    assert.ok(Array.isArray(call.data.metadata.loanSettlementHistory));
    assert.equal(call.data.metadata.loanSettlementHistory.length, 1);
    assert.equal(call.data.metadata.loanSettlementHistory[0].reason, 'loan_adjustment');
    assert.equal(call.data.metadata.loanSettlementHistory[0].note, 'Bulk adjustment');
    assert.equal(call.data.metadata.lastLoanSettlement.reason, 'loan_adjustment');
  }

  const upsertedOrderIds = upsertCalls.map((call) => call.where.orderId).sort();
  assert.deepEqual(upsertedOrderIds, ['ord-1', 'ord-3', 'ord-5']);
  for (const call of upsertCalls) {
    assert.equal(call.create.metadata.note, 'Bulk adjustment');
    assert.equal(call.create.metadata.reason, 'loan_adjustment');
  }
});

test('markLoanOrdersSettled handles invalid input gracefully', async () => {
  prisma.order.findMany = async () => [];
  prisma.order.updateMany = async () => ({ count: 0 });
  prisma.loanEntry.upsert = async () => ({})
  resetTransactionTracking();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 'admin-1';
    next();
  });
  app.post('/admin/merchants/loan/mark-settled', (req, res) => {
    markLoanOrdersSettled(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/mark-settled')
    .send({ orderIds: ['missing-1'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.ok, []);
  assert.deepEqual(res.body.fail, ['missing-1']);
  assert.equal(res.body.errors[0].orderId, 'missing-1');
  assert.equal(prisma.__transactionCallCount, 0);
});

test('markLoanOrdersSettledByRange settles paid orders across paginated batches', async () => {
  process.env.LOAN_FETCH_BATCH_SIZE = '2';
  loggedAction = null;
  resetTransactionTracking();

  const paidOrders = Array.from({ length: 5 }).map((_, index) => ({
    id: `range-ord-${index + 1}`,
    status: 'PAID',
    pendingAmount: index % 2 === 0 ? 100 * (index + 1) : 0,
    settlementAmount: null,
    settlementStatus: 'PENDING',
    subMerchantId: 'sub-range-1',
    metadata: index === 0 ? { loanSettlementHistory: [] } : {},
    loanedAt: null,
  }));

  prisma.order.findMany = async (args: any) => {
    assert.equal(args.where.subMerchantId, 'sub-range-1');
    assert.equal(args.where.status, 'PAID');
    assert.ok(args.where.createdAt.gte instanceof Date);
    assert.ok(args.where.createdAt.lte instanceof Date);
    const { skip, take } = args;
    return paidOrders.slice(skip, skip + take);
  };

  const updateCalls: any[] = [];
  prisma.order.updateMany = async (args: any) => {
    updateCalls.push(args);
    return { count: 1 };
  };

  const upsertCalls: any[] = [];
  prisma.loanEntry.upsert = async (args: any) => {
    upsertCalls.push(args);
    return {};
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 'admin-range';
    next();
  });
  app.post('/admin/merchants/loan/mark-settled/by-range', (req, res) => {
    markLoanOrdersSettledByRange(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/mark-settled/by-range')
    .send({
      subMerchantId: 'sub-range-1',
      startDate: '2024-05-01',
      endDate: '2024-05-31',
      note: 'Range adjust',
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.fail, []);
  assert.equal(res.body.errors.length, 0);
  assert.deepEqual(res.body.ok.sort(), paidOrders.map((o) => o.id).sort());

  const chunkSize = Math.max(1, Number(process.env.LOAN_CREATE_MANY_CHUNK_SIZE ?? '1'));
  const batchSize = Math.max(1, Number(process.env.LOAN_FETCH_BATCH_SIZE ?? '1'));
  const batches = Math.floor(paidOrders.length / batchSize);
  const remainder = paidOrders.length % batchSize;
  let expectedTransactions = batches * Math.ceil(batchSize / chunkSize);
  if (remainder > 0) {
    expectedTransactions += Math.ceil(remainder / chunkSize);
  }
  assert.equal(prisma.__transactionCallCount, expectedTransactions);
  assert.equal(prisma.__transactionOptions.length, expectedTransactions);
  for (const opt of prisma.__transactionOptions) {
    assert.deepEqual(opt, { timeout: 20000 });
  }

  assert.equal(updateCalls.length, paidOrders.length);
  const updatedIds = updateCalls.map((call) => call.where.id).sort();
  assert.deepEqual(updatedIds, paidOrders.map((order) => order.id).sort());
  for (const call of updateCalls) {
    assert.equal(call.where.status, 'PAID');
    assert.equal(call.data.status, 'LN_SETTLED');
    assert.equal(call.data.metadata.lastLoanSettlement.note, 'Range adjust');
    assert.equal(call.data.metadata.lastLoanSettlement.markedBy, 'admin-range');
  }

  const upsertedIds = upsertCalls.map((call) => call.where.orderId).sort();
  assert.deepEqual(
    upsertedIds,
    paidOrders
      .filter((order) => Number(order.pendingAmount ?? 0) > 0)
      .map((order) => order.id)
      .sort(),
  );

  assert.ok(loggedAction);
  assert.equal(loggedAction[0], 'admin-range');
  assert.equal(loggedAction[1], 'loanMarkSettled');
  assert.equal(loggedAction[3].orderIds.length, paidOrders.length);
});

