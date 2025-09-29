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
    createMany: async (_args: any) => ({}),
  },
  $transaction: async (cb: any, options?: any) => {
    prisma.__lastTransactionOptions = options;
    return cb({
      loanEntry: prisma.loanEntry,
      order: {
        updateMany: prisma.order.updateMany,
      },
    });
  },
  __lastTransactionOptions: undefined,
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
  settleLoanOrders,
} = require('../src/controller/admin/loan.controller');

test('getLoanTransactions filters PAID orders by default', async () => {
  const orders = [
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
  assert.deepEqual(receivedFindManyArgs.where.status, { in: ['PAID'] });
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

test('getLoanTransactions can include settled orders when requested', async () => {
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

  prisma.order.findMany = async (args: any) => {
    assert.deepEqual(args.where.status, { in: ['PAID', 'LN_SETTLE'] });
    return orders;
  };
  prisma.order.count = async (args: any) => {
    assert.deepEqual(args.where.status, { in: ['PAID', 'LN_SETTLE'] });
    return 2;
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
      includeSettled: true,
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, [
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
  ]);
  assert.deepEqual(res.body.meta, {
    total: 2,
    page: 1,
    pageSize: 50,
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

test('settleLoanOrders migrates PAID orders to loan entries', async () => {
  loggedAction = null;
  const orderRecords = [
    {
      id: 'ord-5',
      pendingAmount: 300,
      subMerchantId: 'sub-2',
    },
  ];

  prisma.order.findMany = async () => orderRecords;
  const loanCreateManyCalls: any[] = [];
  let orderUpdateManyArgs: any = null;
  prisma.loanEntry.createMany = async (args: any) => {
    loanCreateManyCalls.push(args);
    return { count: args.data.length };
  };
  prisma.order.updateMany = async (args: any) => {
    orderUpdateManyArgs = args;
    return { count: args.where.id.in.length };
  };

  const app = express();
  app.use(express.json());
  app.post('/admin/merchants/loan/settle', (req, res) => {
    (req as any).userId = 'admin-123';
    settleLoanOrders(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/settle')
    .send({ subMerchantId: 'sub-2', orderIds: ['ord-5'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { processed: 1, totalAmount: 300 });
  assert.equal(loanCreateManyCalls.length, 1);
  assert.equal(loanCreateManyCalls[0].data.length, 1);
  assert.equal(loanCreateManyCalls[0].data[0].subMerchantId, 'sub-2');
  assert.equal(loanCreateManyCalls[0].data[0].amount, 300);
  assert.deepEqual(orderUpdateManyArgs.where, {
    id: { in: ['ord-5'] },
    subMerchantId: 'sub-2',
    status: 'PAID',
  });
  assert.equal(orderUpdateManyArgs.data.status, 'LN_SETTLE');
  assert.equal(orderUpdateManyArgs.data.pendingAmount, 0);
  assert.ok(orderUpdateManyArgs.data.loanedAt instanceof Date);
  assert.deepEqual(prisma.__lastTransactionOptions, { timeout: 20000 });
  assert.deepEqual(loggedAction, [
    'admin-123',
    'loanSettle',
    'sub-2',
    { orderIds: ['ord-5'], processed: 1, totalAmount: 300 },
  ]);
});

test('settleLoanOrders handles large batches with chunked createMany calls', async () => {
  loggedAction = null;
  const orderIds = ['ord-a', 'ord-b', 'ord-c', 'ord-d', 'ord-e'];
  prisma.order.findMany = async () =>
    orderIds.map((id, index) => ({
      id,
      pendingAmount: 100 + index,
      subMerchantId: 'sub-99',
    }));

  const loanCreateManyCalls: any[] = [];
  let updateArgs: any = null;
  prisma.loanEntry.createMany = async (args: any) => {
    loanCreateManyCalls.push(args);
    return { count: args.data.length };
  };
  prisma.order.updateMany = async (args: any) => {
    updateArgs = args;
    return { count: orderIds.length };
  };

  const app = express();
  app.use(express.json());
  app.post('/admin/merchants/loan/settle', (req, res) => {
    settleLoanOrders(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/settle')
    .send({ subMerchantId: 'sub-99', orderIds });

  assert.equal(res.status, 200);
  assert.equal(res.body.processed, 5);
  assert.equal(res.body.totalAmount, 5 * 100 + 10); // 100+101+102+103+104 = 510
  assert.equal(loanCreateManyCalls.length, 3);
  assert.deepEqual(
    loanCreateManyCalls.map((call) => call.data.map((entry: any) => entry.orderId)),
    [['ord-a', 'ord-b'], ['ord-c', 'ord-d'], ['ord-e']],
  );
  assert.ok(updateArgs);
  assert.deepEqual(updateArgs.where, {
    id: { in: orderIds },
    subMerchantId: 'sub-99',
    status: 'PAID',
  });
  assert.equal(updateArgs.data.pendingAmount, 0);
  assert.equal(updateArgs.data.status, 'LN_SETTLE');
});

test('settleLoanOrders aborts when order status changes mid process', async () => {
  loggedAction = null;
  const orderIds = ['ord-1', 'ord-2'];
  prisma.order.findMany = async () =>
    orderIds.map((id) => ({ id, pendingAmount: 100, subMerchantId: 'sub-3' }));

  let loanCreateManyCalled = false;
  prisma.loanEntry.createMany = async (_args: any) => {
    loanCreateManyCalled = true;
    return { count: 0 };
  };
  prisma.order.updateMany = async (_args: any) => {
    return { count: 1 };
  };

  const app = express();
  app.use(express.json());
  app.post('/admin/merchants/loan/settle', (req, res) => {
    settleLoanOrders(req as any, res);
  });

  const res = await request(app)
    .post('/admin/merchants/loan/settle')
    .send({ subMerchantId: 'sub-3', orderIds });

  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'Some orders were updated by another process. Please retry.');
  assert.equal(loanCreateManyCalled, false);
  assert.equal(loggedAction, null);
});
