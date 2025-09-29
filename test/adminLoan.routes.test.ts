import './helpers/testEnv'

import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

const prisma: any = {
  order: {
    findMany: async () => [],
    count: async () => 0,
    update: async (_args: any) => ({}),
  },
  loanEntry: {
    create: async (_args: any) => ({}),
  },
  $transaction: async (cb: any) => cb({
    loanEntry: prisma.loanEntry,
    order: {
      update: prisma.order.update,
    },
  }),
};

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
  settleLoanOrders,
} = require('../src/controller/admin/loan.controller');

test('getLoanTransactions filters by WIB range and formats response', async () => {
  const orders = [
    {
      id: 'ord-1',
      amount: 500,
      pendingAmount: 0,
      status: 'LN_SETTLE',
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
  app.get('/admin/loan/transactions', (req, res) =>
    getLoanTransactions(req as any, res),
  );

  const res = await request(app)
    .get('/admin/loan/transactions')
    .query({
      subMerchantId: 'sub-1',
      startDate: '2024-05-01',
      endDate: '2024-05-03',
    });

  assert.equal(res.status, 200);
  assert.ok(receivedFindManyArgs);
  assert.equal(receivedFindManyArgs.where.subMerchantId, 'sub-1');
  assert.deepEqual(receivedFindManyArgs.where.status, { in: ['PAID', 'LN_SETTLE'] });
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
        status: 'LN_SETTLE',
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
    assert.equal(args.take, 100);
    assert.equal(args.skip, 100);
    return [];
  };
  prisma.order.count = async (args: any) => {
    assert.equal(args.where.subMerchantId, 'sub-9');
    return 0;
  };

  const app = express();
  app.get('/admin/loan/transactions', (req, res) =>
    getLoanTransactions(req as any, res),
  );

  const res = await request(app)
    .get('/admin/loan/transactions')
    .query({
      subMerchantId: 'sub-9',
      startDate: '2024-05-01',
      endDate: '2024-05-03',
      page: 2,
      pageSize: 500,
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.meta, {
    total: 0,
    page: 2,
    pageSize: 100,
  });
});

test('settleLoanOrders migrates PAID orders to loan entries', async () => {
  const orderRecords = [
    {
      id: 'ord-5',
      pendingAmount: 300,
      subMerchantId: 'sub-2',
    },
  ];

  prisma.order.findMany = async () => orderRecords;
  const loanCreates: any[] = [];
  const orderUpdates: any[] = [];
  prisma.loanEntry.create = async (args: any) => {
    loanCreates.push(args);
    return { id: 'loan-1' };
  };
  prisma.order.update = async (args: any) => {
    orderUpdates.push(args);
    return { id: args.where.id };
  };

  const app = express();
  app.use(express.json());
  app.post('/admin/loan/settle', (req, res) => {
    (req as any).userId = 'admin-123';
    settleLoanOrders(req as any, res);
  });

  const res = await request(app)
    .post('/admin/loan/settle')
    .send({ subMerchantId: 'sub-2', orderIds: ['ord-5'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { processed: 1, totalAmount: 300 });
  assert.equal(loanCreates.length, 1);
  assert.equal(orderUpdates.length, 1);
  assert.equal(loanCreates[0].data.subMerchantId, 'sub-2');
  assert.equal(loanCreates[0].data.amount, 300);
  assert.equal(orderUpdates[0].data.status, 'LN_SETTLE');
  assert.equal(orderUpdates[0].data.pendingAmount, 0);
  assert.deepEqual(loggedAction, [
    'admin-123',
    'loanSettle',
    'sub-2',
    { orderIds: ['ord-5'], totalAmount: 300 },
  ]);
});
