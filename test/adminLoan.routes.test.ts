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
    deleteMany: async (_args: any) => ({}),
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
  revertLoanOrdersSettled,
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
  assert.deepEqual(receivedFindManyArgs.where.status, {
    in: ['PAID', 'SUCCESS', 'DONE', 'SETTLED', 'LN_SETTLED'],
  });
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
  const orderIds = [
    'ord-paid-1',
    'ord-success',
    'ord-done',
    'ord-settled',
    'ord-failed',
    'ord-missing',
    'ord-paid-2',
  ];
  const fetchedOrders = [
    {
      id: 'ord-paid-1',
      status: 'PAID',
      pendingAmount: 150,
      settlementAmount: null,
      settlementStatus: 'PENDING',
      settlementTime: new Date('2023-12-30T00:00:00Z'),
      subMerchantId: 'sub-1',
      metadata: { loanSettlementHistory: [] },
      loanedAt: null,
    },
    {
      id: 'ord-success',
      status: 'SUCCESS',
      pendingAmount: null,
      settlementAmount: 250,
      settlementStatus: 'PENDING',
      settlementTime: new Date('2023-12-29T00:00:00Z'),
      subMerchantId: 'sub-1',
      metadata: {},
      loanedAt: null,
    },
    {
      id: 'ord-done',
      status: 'DONE',
      pendingAmount: null,
      settlementAmount: 0,
      settlementStatus: 'PENDING',
      settlementTime: new Date('2023-12-28T00:00:00Z'),
      subMerchantId: 'sub-1',
      metadata: {},
      loanedAt: null,
    },
    {
      id: 'ord-settled',
      status: 'LN_SETTLED',
      pendingAmount: null,
      settlementAmount: null,
      settlementStatus: null,
      settlementTime: null,
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
      settlementTime: null,
      subMerchantId: 'sub-2',
      metadata: null,
      loanedAt: null,
    },
    {
      id: 'ord-paid-2',
      status: 'PAID',
      pendingAmount: 0,
      settlementAmount: 125,
      settlementStatus: null,
      settlementTime: null,
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
  assert.deepEqual(
    res.body.ok.sort(),
    ['ord-paid-1', 'ord-success', 'ord-done', 'ord-paid-2', 'ord-settled'].sort(),
  );
  assert.deepEqual(res.body.fail.sort(), ['ord-failed', 'ord-missing'].sort());
  assert.equal(res.body.errors.length, 2);

  const chunkSize = Math.max(1, Number(process.env.LOAN_CREATE_MANY_CHUNK_SIZE ?? '1'));
  const expectedTransactions = Math.ceil(updateCalls.length / chunkSize);
  assert.equal(prisma.__transactionCallCount, expectedTransactions);
  assert.equal(prisma.__transactionOptions.length, expectedTransactions);
  for (const opt of prisma.__transactionOptions) {
    assert.deepEqual(opt, { timeout: 20000 });
  }

  assert.equal(updateCalls.length, 4);
  assert.deepEqual(
    updateCalls.map(call => call.where.id).sort(),
    ['ord-paid-1', 'ord-paid-2', 'ord-success', 'ord-done'].sort(),
  );
  for (const call of updateCalls) {
    assert.equal(['PAID', 'SUCCESS', 'DONE', 'SETTLED'].includes(call.where.status), true);
    assert.equal(call.data.status, 'LN_SETTLED');
    assert.equal(call.data.pendingAmount, null);
    assert.equal(call.data.settlementStatus, null);
    assert.equal(call.data.settlementTime, null);
    assert.equal(call.data.settlementAmount, null);
    assert.deepEqual(call.data.metadata.lastLoanSettlement.reason, 'loan_adjustment');
    assert.equal(call.data.metadata.lastLoanSettlement.note, 'Manual adjust');
    assert.equal(call.data.metadata.lastLoanSettlement.previousStatus, call.where.status);
    const original = fetchedOrders.find(order => order.id === call.where.id);
    const snapshot = call.data.metadata.loanSettlementHistory.at(-1)?.snapshot;
    assert.ok(snapshot);
    assert.equal(snapshot.status, original?.status ?? '');
    assert.equal(snapshot.pendingAmount, original?.pendingAmount ?? null);
    assert.equal(snapshot.settlementStatus, original?.settlementStatus ?? null);
  }

  assert.equal(upsertCalls.length, 3);
  const upsertSummary = upsertCalls.map(call => ({
    orderId: call.create.orderId,
    amount: call.create.amount,
    note: call.create.metadata.note,
  }));
  assert.deepEqual(
    upsertSummary.sort((a, b) => a.orderId.localeCompare(b.orderId)),
    [
      { orderId: 'ord-paid-1', amount: 150, note: 'Manual adjust' },
      { orderId: 'ord-paid-2', amount: 125, note: 'Manual adjust' },
      { orderId: 'ord-success', amount: 250, note: 'Manual adjust' },
    ],
  );

  assert.ok(loggedAction);
  assert.equal(loggedAction[0], 'admin-123');
  assert.equal(loggedAction[1], 'loanMarkSettled');
  assert.deepEqual(
    loggedAction[3].ok.sort(),
    ['ord-paid-1', 'ord-success', 'ord-done', 'ord-paid-2', 'ord-settled'].sort(),
  );
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
    const original = fetchedOrders.find((order) => order.id === call.where.id);
    const snapshot = call.data.metadata.loanSettlementHistory[0].snapshot;
    assert.ok(snapshot);
    assert.equal(snapshot.status, original?.status ?? '');
    assert.equal(snapshot.pendingAmount, original?.pendingAmount ?? null);
    assert.equal(snapshot.settlementStatus, original?.settlementStatus ?? null);
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

  const statuses = ['PAID', 'SUCCESS', 'DONE', 'SETTLED', 'PAID'];
  const paidOrders = statuses.map((status, index) => ({
    id: `range-ord-${index + 1}`,
    status,
    pendingAmount: index % 2 === 0 ? 100 * (index + 1) : null,
    settlementAmount: index % 2 === 0 ? null : 75 * (index + 1),
    settlementStatus: 'PENDING',
    settlementTime: new Date(`2023-12-${20 + index}T00:00:00.000Z`),
    subMerchantId: 'sub-range-1',
    metadata: index === 0 ? { loanSettlementHistory: [] } : {},
    loanedAt: null,
  }));

  let fetchIndex = 0;
  prisma.order.findMany = async (args: any) => {
    assert.equal(args.where.subMerchantId, 'sub-range-1');
    assert.deepEqual(args.where.status, { in: ['PAID', 'SUCCESS', 'DONE', 'SETTLED'] });
    assert.ok(args.where.createdAt.gte instanceof Date);
    assert.ok(args.where.createdAt.lte instanceof Date);
    const take = typeof args.take === 'number' ? args.take : paidOrders.length;
    const start = fetchIndex;
    const end = Math.min(fetchIndex + take, paidOrders.length);
    fetchIndex = end;
    return paidOrders.slice(start, end);
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
    assert.ok(['PAID', 'SUCCESS', 'DONE', 'SETTLED'].includes(call.where.status));
    assert.equal(call.data.status, 'LN_SETTLED');
    assert.equal(call.data.metadata.lastLoanSettlement.note, 'Range adjust');
    assert.equal(call.data.metadata.lastLoanSettlement.markedBy, 'admin-range');
    assert.equal(call.data.metadata.lastLoanSettlement.previousStatus, call.where.status);
    assert.equal(call.data.settlementStatus, null);
    assert.equal(call.data.settlementTime, null);
    assert.equal(call.data.settlementAmount, null);
    const original = paidOrders.find(order => order.id === call.where.id);
    const snapshot = call.data.metadata.loanSettlementHistory.at(-1)?.snapshot;
    assert.ok(snapshot);
    assert.equal(snapshot.status, original?.status ?? '');
    assert.equal(snapshot.pendingAmount, original?.pendingAmount ?? null);
    assert.equal(snapshot.settlementStatus, original?.settlementStatus ?? null);
  }

  const upsertedIds = upsertCalls.map((call) => call.where.orderId).sort();
  assert.deepEqual(
    upsertedIds,
    paidOrders
      .filter((order) => Number(order.pendingAmount ?? 0) > 0 || Number(order.settlementAmount ?? 0) > 0)
      .map((order) => order.id)
      .sort(),
  );

  assert.ok(loggedAction);
  assert.equal(loggedAction[0], 'admin-range');
  assert.equal(loggedAction[1], 'loanMarkSettled');
  assert.equal(loggedAction[3].orderIds.length, paidOrders.length);
});

test('revertLoanOrdersSettled restores loan-settled orders', async () => {
  loggedAction = null;
  resetTransactionTracking();

  const loanedAt = new Date('2024-06-01T00:00:00.000Z');
  const historyEntry = {
    reason: 'loan_adjustment',
    previousStatus: 'SUCCESS',
    markedAt: '2024-06-01T00:00:00.000Z',
    markedBy: 'admin-old',
    snapshot: {
      status: 'SUCCESS',
      pendingAmount: 0,
      settlementStatus: 'PAID',
      settlementAmount: 100,
      settlementTime: '2024-05-31T23:00:00.000Z',
      loanedAt: null,
      loanEntry: { amount: null },
    },
  };

  const order = {
    id: 'loan-revert-1',
    status: 'LN_SETTLED',
    pendingAmount: null,
    settlementAmount: null,
    settlementStatus: null,
    settlementTime: loanedAt,
    metadata: {
      loanSettlementHistory: [historyEntry],
      lastLoanSettlement: historyEntry,
    },
    subMerchantId: 'sub-revert',
    loanedAt,
    createdAt: new Date('2024-05-15T00:00:00.000Z'),
  };

  let fetchCount = 0;
  prisma.order.findMany = async () => {
    if (fetchCount > 0) {
      return [];
    }
    fetchCount += 1;
    return [order];
  };

  const updateCalls: any[] = [];
  prisma.order.updateMany = async (args: any) => {
    updateCalls.push(args);
    return { count: 1 };
  };

  const deleteCalls: any[] = [];
  prisma.loanEntry.deleteMany = async (args: any) => {
    deleteCalls.push(args);
    return { count: 1 };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 'admin-revert';
    next();
  });
  app.post('/admin/merchants/loan/revert/by-range', (req, res) => {
    revertLoanOrdersSettled(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/revert/by-range')
    .send({
      subMerchantId: 'sub-revert',
      startDate: '2024-06-01',
      endDate: '2024-06-02',
      note: 'Undo loan',
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.ok, ['loan-revert-1']);
  assert.deepEqual(res.body.fail, []);
  assert.equal(res.body.errors.length, 0);
  assert.equal(res.body.events.length, 1);
  assert.ok(res.body.exportFile);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].where.status, 'LN_SETTLED');
  assert.equal(updateCalls[0].data.status, 'SUCCESS');
  assert.equal(deleteCalls.length, 1);
  assert.ok(loggedAction);
  assert.equal(loggedAction[0], 'admin-revert');
  assert.equal(loggedAction[1], 'loanRevertSettled');
});

test('revertLoanOrdersSettled handles exportOnly requests', async () => {
  loggedAction = null;
  resetTransactionTracking();

  const historyEntry = {
    reason: 'loan_adjustment',
    previousStatus: 'SUCCESS',
    markedAt: '2024-06-05T00:00:00.000Z',
    markedBy: 'admin-old',
    snapshot: {
      status: 'SUCCESS',
      pendingAmount: 200,
      settlementStatus: 'PAID',
      settlementAmount: 200,
      settlementTime: '2024-06-04T23:00:00.000Z',
      loanedAt: null,
      loanEntry: { amount: null },
    },
  };

  let exportFetchCount = 0;
  prisma.order.findMany = async () => {
    if (exportFetchCount > 0) {
      return [];
    }
    exportFetchCount += 1;
    return [
      {
        id: 'loan-export-1',
        status: 'LN_SETTLED',
        pendingAmount: null,
        settlementAmount: null,
        settlementStatus: null,
        settlementTime: new Date('2024-06-05T00:00:00.000Z'),
        metadata: { loanSettlementHistory: [historyEntry], lastLoanSettlement: historyEntry },
        subMerchantId: 'sub-export',
        loanedAt: new Date('2024-06-05T00:00:00.000Z'),
        createdAt: new Date('2024-05-20T00:00:00.000Z'),
      },
    ];
  };

  prisma.order.updateMany = async () => {
    throw new Error('should not update during export');
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 'admin-revert';
    next();
  });
  app.post('/admin/merchants/loan/revert/by-range', (req, res) => {
    revertLoanOrdersSettled(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/revert/by-range')
    .send({
      subMerchantId: 'sub-export',
      startDate: '2024-06-01',
      endDate: '2024-06-10',
      exportOnly: true,
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.ok, ['loan-export-1']);
  assert.equal(res.body.events.length, 0);
  assert.ok(res.body.exportFile);
  assert.ok(loggedAction);
  assert.equal(loggedAction[1], 'loanRevertSettled');
  assert.equal(loggedAction[3].exportOnly, true);
});

