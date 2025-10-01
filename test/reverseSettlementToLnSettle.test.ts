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
  },
  partnerClient: {
    update: async () => ({}),
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

const { reverseSettlementToLnSettle } = require('../src/controller/admin/settlementAdjustment.controller')

function createApp() {
  const app = express()
  app.use(express.json())
  app.post('/settlement/reverse', (req, res) => {
    ;(req as any).userId = 'admin1'
    reverseSettlementToLnSettle(req as any, res)
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
      status: 'SETTLED',
      settlementTime: now,
      settlementAmount: 100,
      amount: 200,
      fee3rdParty: 50,
      feeLauncx: 50,
      metadata: {},
      subMerchantId: null,
      partnerClientId: 'partner-a',
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
  assert.deepEqual(res.body.partnerBalanceAdjustments, [
    { partnerClientId: 'partner-a', amount: totalOrders * 100 },
  ])
})

test('rejects ineligible statuses and missing settlement time', { concurrency: 1 }, async () => {
  const ids = ['eligible', 'already-ln-settle', 'missing-settlement', 'invalid-status', 'missing-order']
  const now = new Date()
  const prisma = require.cache[prismaPath].exports.prisma

  prisma.order.findMany = async () => [
    {
      id: 'eligible',
      status: 'SETTLED',
      settlementTime: now,
      settlementAmount: 80,
      amount: 100,
      fee3rdParty: 10,
      feeLauncx: 10,
      metadata: {},
      subMerchantId: null,
      partnerClientId: null,
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
      subMerchantId: null,
      partnerClientId: null,
    },
    {
      id: 'missing-settlement',
      status: 'SETTLED',
      settlementTime: null,
      settlementAmount: null,
      amount: 100,
      fee3rdParty: 0,
      feeLauncx: 0,
      metadata: {},
      subMerchantId: null,
      partnerClientId: null,
    },
    {
      id: 'invalid-status',
      status: 'PAID',
      settlementTime: now,
      settlementAmount: 70,
      amount: 100,
      fee3rdParty: 10,
      feeLauncx: 20,
      metadata: {},
      subMerchantId: null,
      partnerClientId: null,
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

  const errorMessages = new Map(res.body.errors.map((err: any) => [err.id, err.message]))
  assert.equal(
    errorMessages.get('invalid-status'),
    'Status PAID tidak dapat direversal'
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
      status: 'SETTLED',
      settlementTime: now,
      settlementAmount: null,
      amount: 150,
      fee3rdParty: 25,
      feeLauncx: 5,
      metadata: {},
      subMerchantId: null,
      partnerClientId: 'partner-1',
    },
    {
      id: 'order-2',
      status: 'SETTLED',
      settlementTime: now,
      settlementAmount: 60,
      amount: 0,
      fee3rdParty: 0,
      feeLauncx: 0,
      metadata: {},
      subMerchantId: null,
      partnerClientId: 'partner-1',
    },
    {
      id: 'order-3',
      status: 'SETTLED',
      settlementTime: now,
      settlementAmount: 40,
      amount: 0,
      fee3rdParty: 0,
      feeLauncx: 0,
      metadata: {},
      subMerchantId: null,
      partnerClientId: 'partner-2',
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
})
