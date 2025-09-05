import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

const prismaPath = require.resolve('../src/core/prisma')
const prismaMock: any = {
  order: { findMany: async () => [], update: async () => {} },
  transaction_request: { findMany: async () => [], update: async () => {} },
}
prismaMock.$transaction = async (fn: any) => fn(prismaMock)
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

const { adjustSettlements } = require('../src/controller/admin/settlementAdjustment.controller')

const app = express()
app.use(express.json())
app.post('/settlement/adjust', (req, res) => {
  ;(req as any).userId = 'admin1'
  adjustSettlements(req as any, res)
})

test('rejects when transactionIds and date range both provided', async () => {
  const res = await request(app)
    .post('/settlement/adjust')
    .send({
      transactionIds: ['1'],
      dateFrom: '2024-01-01',
      dateTo: '2024-01-02',
      settlementStatus: 'pending',
    })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'provide either transactionIds or date range, not both')
})

test('rejects when neither transactionIds nor date range provided', async () => {
  const res = await request(app)
    .post('/settlement/adjust')
    .send({
      settlementStatus: 'pending',
    })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'transactionIds or date range required')
})

test('returns ids of updated settlements', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  prisma.order.findMany = async () => [
    { id: 'o1', amount: 100, fee3rdParty: 0, feeLauncx: 0 },
  ]
  prisma.transaction_request.findMany = async () => []
  let orderUpdate: any
  prisma.order.update = async ({ data }: any) => {
    orderUpdate = data
    return {}
  }
  const res = await request(app)
    .post('/settlement/adjust')
    .send({ transactionIds: ['o1'], settlementStatus: 'SETTLED', feeLauncx: 5 })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.data.ids, ['o1'])
  assert.equal(res.body.data.updated, 1)
  assert.equal(orderUpdate.feeLauncx, 5)
  assert.equal(orderUpdate.settlementAmount, 95)
})

test('adjusting PAID order to SETTLED updates both status and settlementStatus', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  prisma.order.findMany = async () => [
    { id: 'o2', amount: 200, fee3rdParty: 0, feeLauncx: 0 },
  ]
  prisma.transaction_request.findMany = async () => []
  let updatedData: any
  prisma.order.update = async ({ data }: any) => {
    updatedData = data
    return {}
  }
  const res = await request(app)
    .post('/settlement/adjust')
    .send({ transactionIds: ['o2'], settlementStatus: 'SETTLED' })
  assert.equal(res.status, 200)
  assert.equal(updatedData.settlementStatus, 'SETTLED')
  assert.equal(updatedData.status, 'SETTLED')
  assert.equal(updatedData.pendingAmount, null)
})

test('non-final settlementStatus does not change order status', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  prisma.order.findMany = async () => [
    { id: 'o5', amount: 100, fee3rdParty: 0, feeLauncx: 0 },
  ]
  prisma.transaction_request.findMany = async () => []
  let updatedData: any
  prisma.order.update = async ({ data }: any) => {
    updatedData = data
    return {}
  }
  const res = await request(app)
    .post('/settlement/adjust')
    .send({ transactionIds: ['o5'], settlementStatus: 'PENDING' })
  assert.equal(res.status, 200)
  assert.equal(updatedData.settlementStatus, 'PENDING')
  assert.ok(!('status' in updatedData))
  assert.ok(!('pendingAmount' in updatedData))
})

test('unpaid orders are ignored by adjustment routine', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  let whereArg: any
  prisma.order.findMany = async ({ where }: any) => {
    whereArg = where
    return []
  }
  prisma.transaction_request.findMany = async () => []
  let updateCalled = false
  prisma.order.update = async () => {
    updateCalled = true
    return {}
  }
  const res = await request(app)
    .post('/settlement/adjust')
    .send({ transactionIds: ['o3'], settlementStatus: 'SETTLED' })
  assert.equal(res.status, 200)
  assert.equal(res.body.data.updated, 0)
  assert.equal(updateCalled, false)
  assert.equal(whereArg.status, 'PAID')
})

test('updates old transaction requests', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  prisma.order.findMany = async () => []
  let trxWhere: any
  prisma.transaction_request.findMany = async ({ where }: any) => {
    trxWhere = where
    return [{ id: 't1', amount: 200, settlementAmount: null }]
  }
  let trxUpdate: any
  prisma.transaction_request.update = async ({ data }: any) => {
    trxUpdate = data
    return {}
  }
  const res = await request(app)
    .post('/settlement/adjust')
    .send({ transactionIds: ['t1'], settlementStatus: 'SETTLED', feeLauncx: { t1: 10 }, settlementTime: '2024-01-01' })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.data.ids, ['t1'])
  assert.equal(res.body.data.updated, 1)
  assert.equal(trxWhere.status, 'SUCCESS')
  assert.equal(trxUpdate.settlementAmount, 180)
})

test('returns 500 when enums are invalid', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  prisma.order.findMany = async () => [
    { id: 'o4', amount: 100, fee3rdParty: 0, feeLauncx: 0 },
  ]
  prisma.transaction_request.findMany = async () => []
  prisma.order.update = async () => {
    throw new Error('invalid enum')
  }
  const res = await request(app)
    .post('/settlement/adjust')
    .send({ transactionIds: ['o4'], settlementStatus: 'WRONG' })
  assert.equal(res.status, 500)
})

