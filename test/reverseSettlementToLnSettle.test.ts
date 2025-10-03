import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

const prismaPath = require.resolve('../src/core/prisma')
const prismaMock: any = {
  order: {
    findMany: async () => [],
    updateMany: async () => ({ count: 0 }),
    count: async () => 0,
  },
  partnerClient: {
    update: async () => ({}),
  },
  subMerchantBalance: {
    update: async () => ({}),
  },
  loanEntry: {
    upsert: async () => ({}),
  },
}

prismaMock.$transaction = async (arg: any) => {
  if (typeof arg === 'function') {
    return arg(prismaMock)
  }
  if (Array.isArray(arg)) {
    return Promise.all(arg)
  }
  return []
}

require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: prismaMock,
  },
} as any

import * as adminLog from '../src/util/adminLog'
;(adminLog as any).logAdminAction = async () => {}

const {
  reverseSettlementToLnSettle,
  getEligibleSettlements,
  previewCleanupReversalMetadata,
  cleanupReversalMetadataHandler,
} = require('../src/controller/admin/settlementAdjustment.controller')

function createApp() {
  const app = express()
  app.use(express.json())
  app.post('/settlement/reverse', (req, res) => {
    ;(req as any).userId = 'admin1'
    reverseSettlementToLnSettle(req as any, res)
  })
  return app
}

function createEligibleApp() {
  const app = express()
  app.get('/admin/settlement/eligible', (req, res) => {
    ;(req as any).userId = 'admin1'
    getEligibleSettlements(req as any, res)
  })
  return app
}

function createCleanupApp() {
  const app = express()
  app.use(express.json())
  app.get('/admin/settlement/cleanup-reversal/preview', (req, res) => {
    ;(req as any).userId = 'admin1'
    previewCleanupReversalMetadata(req as any, res)
  })
  app.post('/admin/settlement/cleanup-reversal', (req, res) => {
    ;(req as any).userId = 'admin1'
    cleanupReversalMetadataHandler(req as any, res)
  })
  return app
}

test('processes hundreds of reversals in limited batches', { concurrency: 1 }, async () => {
  const totalOrders = 250
  const ids = Array.from({ length: totalOrders }, (_, i) => `order-${i + 1}`)
  const now = new Date()
  const prisma = require.cache[prismaPath].exports.prisma

  prisma.order.findMany = async () =>
    ids.map(id => ({
      id,
      status: 'SUCCESS',
      settlementTime: now,
      settlementAmount: 100,
      amount: 200,
      fee3rdParty: 50,
      feeLauncx: 50,
      metadata: {},
      subMerchantId: 'sub-merchant-1',
      partnerClientId: 'partner-a',
      loanEntry: null,
    }))

  let concurrent = 0
  let maxConcurrent = 0
  let updateCalls = 0
  prisma.order.updateMany = async () => {
    updateCalls += 1
    concurrent += 1
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    await new Promise(resolve => setTimeout(resolve, 5))
    concurrent -= 1
    return { count: 1 }
  }

  let totalBalanceDecrement = 0
  prisma.partnerClient.update = async ({ data }: any) => {
    totalBalanceDecrement += Number(data?.balance?.decrement ?? 0)
    return {}
  }

  let subMerchantBalanceDecrement = 0
  let subMerchantBalanceUpdates = 0
  prisma.subMerchantBalance.update = async ({ data }: any) => {
    subMerchantBalanceUpdates += 1
    subMerchantBalanceDecrement += Number(data?.availableBalance?.decrement ?? 0)
    return {}
  }

  let loanUpserts = 0
  prisma.loanEntry.upsert = async () => {
    loanUpserts += 1
    return {}
  }

  const app = createApp()
  const res = await request(app)
    .post('/settlement/reverse')
    .send({ orderIds: ids })

  assert.equal(res.status, 200)
  assert.equal(res.body.processed, totalOrders)
  assert.equal(res.body.ok, totalOrders)
  assert.equal(res.body.fail, 0)
  assert.equal(res.body.totalReversalAmount, totalOrders * 100)
  assert.equal(updateCalls, totalOrders)
  assert.ok(
    maxConcurrent <= 25,
    `expected max concurrent updates to be limited to 25, got ${maxConcurrent}`
  )
  assert.equal(totalBalanceDecrement, totalOrders * 100)
  assert.equal(subMerchantBalanceDecrement, totalOrders * 100)
  const expectedSubMerchantBalanceUpdates = Math.ceil(totalOrders / 25)
  assert.equal(subMerchantBalanceUpdates, expectedSubMerchantBalanceUpdates)
  assert.deepEqual(res.body.partnerBalanceAdjustments, [
    { partnerClientId: 'partner-a', amount: totalOrders * 100 },
  ])
  assert.deepEqual(res.body.subMerchantBalanceAdjustments, [
    { subMerchantId: 'sub-merchant-1', amount: totalOrders * 100 },
  ])
  assert.equal(loanUpserts, totalOrders)
})

test('eligible settlements include PAID orders flagged as settled', { concurrency: 1 }, async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  const start = new Date('2024-01-01T00:00:00.000Z')
  const end = new Date('2024-01-03T00:00:00.000Z')

  let capturedWhere: any = null
  let capturedSelect: any = null

  prisma.order.findMany = async (args: any) => {
    capturedWhere = args?.where
    capturedSelect = args?.select
    return [
      {
        id: 'order-eligible',
        subMerchantId: 'sub-merchant-eligible',
        status: 'PAID',
        settlementStatus: 'SETTLED',
        settlementTime: new Date('2024-01-02T03:04:05.000Z'),
        settlementAmount: 150,
        amount: 200,
        fee3rdParty: 25,
        feeLauncx: 25,
      },
    ]
  }

  prisma.order.count = async () => 1

  const app = createEligibleApp()
  const res = await request(app)
    .get('/admin/settlement/eligible')
    .query({
      subMerchantId: 'sub-merchant-eligible',
      settled_from: start.toISOString(),
      settled_to: end.toISOString(),
    })

  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.data))
  assert.equal(res.body.data.length, 1)
  assert.equal(res.body.data[0]?.id, 'order-eligible')
  assert.equal(res.body.data[0]?.status, 'PAID')
  assert.equal(res.body.data[0]?.settlementStatus, 'SETTLED')
  assert.equal(typeof res.body.data[0]?.settlementTime, 'string')

  assert.deepEqual(capturedWhere?.status?.in, ['PAID', 'DONE', 'SUCCESS'])
  assert.equal(capturedWhere?.settlementStatus, undefined)
  assert.equal(capturedSelect?.settlementStatus, true)
})

test('allows reversing LN_SETTLED orders and debits partner balance', { concurrency: 1 }, async () => {
  const orderId = 'ln-settled-order'
  const now = new Date()
  const prisma = require.cache[prismaPath].exports.prisma

  prisma.order.findMany = async () => [
    {
      id: orderId,
      status: 'LN_SETTLED',
      settlementTime: now,
      settlementAmount: 125,
      amount: 0,
      fee3rdParty: 0,
      feeLauncx: 0,
      metadata: {},
      subMerchantId: 'sub-merchant-ln',
      partnerClientId: 'partner-ln',
      loanEntry: null,
    },
  ]

  const updateArgs: any[] = []
  prisma.order.updateMany = async (args: any) => {
    updateArgs.push(args)
    return { count: 1 }
  }

  let partnerDebit = 0
  prisma.partnerClient.update = async ({ data }: any) => {
    partnerDebit += Number(data?.balance?.decrement ?? 0)
    return {}
  }

  let subMerchantBalanceDebit = 0
  prisma.subMerchantBalance.update = async ({ data }: any) => {
    subMerchantBalanceDebit += Number(data?.availableBalance?.decrement ?? 0)
    return {}
  }

  const app = createApp()
  const res = await request(app)
    .post('/settlement/reverse')
    .send({ orderIds: [orderId] })

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, 1)
  assert.equal(res.body.fail, 0)
  assert.equal(res.body.totalReversalAmount, 125)
  assert.equal(partnerDebit, 125)
  assert.equal(subMerchantBalanceDebit, 125)

  assert.equal(updateArgs.length, 1)
  assert.equal(updateArgs[0]?.where?.status?.in.includes('LN_SETTLED'), true)
  assert.equal(updateArgs[0]?.data?.status, 'LN_SETTLE')
})

test('rejects ineligible statuses and missing settlement time', { concurrency: 1 }, async () => {
  const ids = ['eligible', 'already-ln-settle', 'missing-settlement', 'invalid-status', 'missing-order']
  const now = new Date()
  const prisma = require.cache[prismaPath].exports.prisma

  prisma.order.findMany = async () => [
    {
      id: 'eligible',
      status: 'SUCCESS',
      settlementTime: now,
      settlementAmount: 80,
      amount: 100,
      fee3rdParty: 10,
      feeLauncx: 10,
      metadata: {},
      subMerchantId: 'sub-merchant-1',
      partnerClientId: null,
      loanEntry: null,
    },
    {
      id: 'already-ln-settle',
      status: 'LN_SETTLE',
      settlementTime: null,
      settlementAmount: null,
      amount: 0,
      fee3rdParty: 0,
      feeLauncx: 0,
      metadata: {},
      subMerchantId: 'sub-merchant-1',
      partnerClientId: null,
      loanEntry: null,
    },
    {
      id: 'missing-settlement',
      status: 'SUCCESS',
      settlementTime: null,
      settlementAmount: null,
      amount: 100,
      fee3rdParty: 0,
      feeLauncx: 0,
      metadata: {},
      subMerchantId: 'sub-merchant-1',
      partnerClientId: null,
      loanEntry: null,
    },
    {
      id: 'invalid-status',
      status: 'PENDING',
      settlementTime: now,
      settlementAmount: 70,
      amount: 100,
      fee3rdParty: 10,
      feeLauncx: 20,
      metadata: {},
      subMerchantId: 'sub-merchant-1',
      partnerClientId: null,
      loanEntry: null,
    },
  ]

  const updatedIds: string[] = []
  prisma.order.updateMany = async ({ where }: any) => {
    updatedIds.push(where.id)
    return { count: 1 }
  }

  prisma.partnerClient.update = async () => {
    throw new Error('should not update partner balance when no partnerClientId')
  }

  const loanEntryPayloads: any[] = []
  prisma.loanEntry.upsert = async (args: any) => {
    loanEntryPayloads.push(args)
    return {}
  }

  const app = createApp()
  const res = await request(app)
    .post('/settlement/reverse')
    .send({ orderIds: ids })

  assert.equal(res.status, 200)
  assert.equal(res.body.processed, ids.length)
  assert.equal(res.body.ok, 2)
  assert.equal(res.body.fail, ids.length - 2)
  assert.equal(res.body.totalReversalAmount, 80)
  assert.deepEqual(updatedIds, ['eligible'])

  assert.equal(loanEntryPayloads.length, 1)
  assert.equal(loanEntryPayloads[0]?.create?.amount, 80)

  const errorMessages = new Map(res.body.errors.map((err: any) => [err.id, err.message]))
  assert.equal(
    errorMessages.get('invalid-status'),
    'Status PENDING tidak dapat direversal'
  )
  assert.equal(
    errorMessages.get('missing-settlement'),
    'Order belum memiliki settlementTime'
  )
  assert.equal(
    errorMessages.get('missing-order'),
    'Order tidak ditemukan atau tidak sesuai sub-merchant'
  )
  assert.equal(
    errorMessages.get('eligible'),
    'Order berhasil direversal tetapi tidak memiliki partnerClientId untuk penyesuaian saldo'
  )
  assert.deepEqual(res.body.partnerBalanceAdjustments, [])
})

test('decrements partner balance by reversed amount', { concurrency: 1 }, async () => {
  const ids = ['order-1', 'order-2', 'order-3']
  const now = new Date()
  const prisma = require.cache[prismaPath].exports.prisma

  prisma.order.findMany = async () => [
    {
      id: 'order-1',
      status: 'SUCCESS',
      settlementTime: now,
      settlementAmount: null,
      amount: 150,
      fee3rdParty: 25,
      feeLauncx: 5,
      metadata: {},
      subMerchantId: 'sub-merchant-1',
      partnerClientId: 'partner-1',
      loanEntry: null,
    },
    {
      id: 'order-2',
      status: 'SUCCESS',
      settlementTime: now,
      settlementAmount: 60,
      amount: 0,
      fee3rdParty: 0,
      feeLauncx: 0,
      metadata: {},
      subMerchantId: 'sub-merchant-1',
      partnerClientId: 'partner-1',
      loanEntry: null,
    },
    {
      id: 'order-3',
      status: 'SUCCESS',
      settlementTime: now,
      settlementAmount: 40,
      amount: 0,
      fee3rdParty: 0,
      feeLauncx: 0,
      metadata: {},
      subMerchantId: 'sub-merchant-2',
      partnerClientId: 'partner-2',
      loanEntry: null,
    },
  ]

  prisma.order.updateMany = async () => ({ count: 1 })

  const balanceUpdates: Record<string, number> = {}
  prisma.partnerClient.update = async ({ where, data }: any) => {
    const id = where.id
    const decrement = Number(data?.balance?.decrement ?? 0)
    balanceUpdates[id] = (balanceUpdates[id] ?? 0) + decrement
    return {}
  }

  const loanEntryPayloads: any[] = []
  prisma.loanEntry.upsert = async (args: any) => {
    loanEntryPayloads.push(args)
    return {}
  }

  const app = createApp()
  const res = await request(app)
    .post('/settlement/reverse')
    .send({ orderIds: ids })

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, ids.length)
  assert.equal(res.body.fail, 0)

  const expectedPartnerTotals = {
    'partner-1': 150 - 25 - 5 + 60,
    'partner-2': 40,
  }

  assert.deepEqual(balanceUpdates, expectedPartnerTotals)
  assert.deepEqual(
    res.body.partnerBalanceAdjustments.sort((a: any, b: any) => a.partnerClientId.localeCompare(b.partnerClientId)),
    Object.entries(expectedPartnerTotals)
      .map(([partnerClientId, amount]) => ({ partnerClientId, amount }))
      .sort((a, b) => a.partnerClientId.localeCompare(b.partnerClientId))
  )
  assert.equal(loanEntryPayloads.length, ids.length)
})

test('persists loan entry metadata alongside reversal updates', { concurrency: 1 }, async () => {
  const orderId = 'order-loan-1'
  const now = new Date()
  const prisma = require.cache[prismaPath].exports.prisma

  prisma.order.findMany = async () => [
    {
      id: orderId,
      status: 'SUCCESS',
      settlementTime: now,
      settlementAmount: null,
      amount: 150,
      fee3rdParty: 15,
      feeLauncx: 5,
      metadata: {},
      subMerchantId: 'sub-loan-1',
      partnerClientId: 'partner-loan-1',
      loanEntry: {
        amount: 120,
        metadata: { previous: true },
        subMerchantId: 'sub-loan-1',
      },
    },
  ]

  const updateArgs: any[] = []
  prisma.order.updateMany = async (args: any) => {
    updateArgs.push(args)
    return { count: 1 }
  }

  prisma.subMerchantBalance.update = async () => ({})

  let loanEntryArgs: any = null
  prisma.loanEntry.upsert = async (args: any) => {
    loanEntryArgs = args
    return {}
  }

  let balanceAdjustment = 0
  prisma.partnerClient.update = async ({ data }: any) => {
    balanceAdjustment += Number(data?.balance?.decrement ?? 0)
    return {}
  }

  const app = createApp()
  const res = await request(app)
    .post('/settlement/reverse')
    .send({ orderIds: [orderId], reason: 'manual review' })

  const expectedAmount = 150 - 15 - 5

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, 1)
  assert.equal(res.body.fail, 0)
  assert.equal(res.body.totalReversalAmount, expectedAmount)

  assert.equal(updateArgs.length, 1)
  assert.equal(updateArgs[0]?.data?.status, 'LN_SETTLE')
  assert.equal(updateArgs[0]?.data?.pendingAmount, null)

  assert.ok(loanEntryArgs)
  assert.equal(loanEntryArgs?.where?.orderId, orderId)
  assert.equal(loanEntryArgs?.update?.amount, expectedAmount)
  assert.equal(loanEntryArgs?.update?.subMerchantId, 'sub-loan-1')
  assert.equal(loanEntryArgs?.update?.metadata?.previous, true)
  assert.equal(loanEntryArgs?.update?.metadata?.lastAction, 'reverseSettlementToLnSettle')
  assert.equal(loanEntryArgs?.update?.metadata?.reversal?.amount, expectedAmount)
  assert.equal(loanEntryArgs?.update?.metadata?.reversal?.reason, 'manual review')
  assert.equal(loanEntryArgs?.update?.metadata?.reversal?.reversedBy, 'admin1')
  assert.equal(typeof loanEntryArgs?.update?.metadata?.reversal?.reversedAt, 'string')

  assert.equal(balanceAdjustment, expectedAmount)
})

test('preview cleanup reversal metadata returns affected order ids without persisting', async () => {
  const prisma = require.cache[prismaPath].exports.prisma

  let capturedWhere: any = null
  let orderUpdateCalls = 0

  prisma.order.findMany = async (args: any) => {
    capturedWhere = args?.where
    return [
      {
        id: 'order-1',
        metadata: { reversal: { reason: 'loan' }, keep: true },
        loanedAt: new Date('2024-05-01T02:00:00Z'),
        loanEntry: null,
      },
      {
        id: 'order-2',
        metadata: { reversal: true, previousStatus: 'DONE', keep: 'value' },
        loanedAt: new Date('2024-05-01T04:00:00Z'),
        loanEntry: { id: 'loan-entry-1', metadata: { reversal: { note: 'x' } } },
      },
    ]
  }

  prisma.order.update = async () => {
    orderUpdateCalls += 1
    return {}
  }

  const app = createCleanupApp()
  const res = await request(app)
    .get('/admin/settlement/cleanup-reversal/preview')
    .query({ startDate: '2024-05-01', endDate: '2024-05-02', subMerchantId: 'sub-1' })

  assert.equal(res.status, 200)
  assert.equal(res.body.total, 2)
  assert.equal(res.body.cleaned, 2)
  assert.equal(res.body.dryRun, true)
  assert.deepEqual(res.body.updatedOrderIds, ['order-1', 'order-2'])
  assert.equal(orderUpdateCalls, 0)
  assert.deepEqual(capturedWhere.subMerchantId, 'sub-1')
  assert.ok(Array.isArray(capturedWhere.NOT))
  assert.ok(
    capturedWhere.NOT?.some(
      (clause: any) =>
        clause?.metadata?.path?.[0] === 'reversal' && clause?.metadata?.equals === null,
    ),
  )
  })

test('cleanup reversal metadata resets loanedAt and logs admin action', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  const updates: any[] = []
  const loanEntryUpdates: any[] = []

  prisma.order.findMany = async () => [
    {
      id: 'order-cleanup',
      metadata: {
        reversal: { reason: 'loan' },
        previousSettlementAmount: 200,
        keep: 'value',
      },
      loanedAt: new Date('2024-05-01T01:00:00Z'),
      loanEntry: {
        id: 'loan-entry-cleanup',
        metadata: { reversal: { reason: 'loan' }, lastAction: 'reverseSettlementToLnSettle', keep: true },
      },
    },
  ]

  prisma.order.update = async (args: any) => {
    updates.push(args)
    return {}
  }

  prisma.loanEntry.update = async (args: any) => {
    loanEntryUpdates.push(args)
    return {}
  }

  let logged: any = null
  ;(adminLog as any).logAdminAction = async (userId: string, action: string, _ctx: any, meta: any) => {
    logged = { userId, action, meta }
  }

  const app = createCleanupApp()
  const res = await request(app)
    .post('/admin/settlement/cleanup-reversal')
    .send({ startDate: '2024-05-01', endDate: '2024-05-02' })

  assert.equal(res.status, 200)
  assert.equal(res.body.cleaned, 1)
  assert.equal(res.body.dryRun, false)
  assert.deepEqual(res.body.updatedOrderIds, ['order-cleanup'])

  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0], {
    where: { id: 'order-cleanup' },
    data: {
      metadata: { keep: 'value' },
      loanedAt: null,
    },
  })

  assert.equal(loanEntryUpdates.length, 1)
  assert.deepEqual(loanEntryUpdates[0], {
    where: { id: 'loan-entry-cleanup' },
    data: { metadata: { keep: true } },
  })

  assert.ok(logged)
  assert.equal(logged.userId, 'admin1')
  assert.equal(logged.action, 'cleanupReversalMetadata')
  assert.deepEqual(logged.meta.updatedOrderIds, ['order-cleanup'])
  assert.equal(logged.meta.startDate, '2024-05-01')
  assert.equal(logged.meta.endDate, '2024-05-02')
})
