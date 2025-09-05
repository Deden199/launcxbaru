import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

const prismaPath = require.resolve('../src/core/prisma')
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: {
      order: { findMany: async () => [], update: async () => {} },
      transaction_request: { findMany: async () => [], update: async () => {} },
    },
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
  const res = await request(app)
    .post('/settlement/adjust')
    .send({ transactionIds: ['o1'], settlementStatus: 'SETTLED' })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.data.ids, ['o1'])
  assert.equal(res.body.data.updated, 1)
})

test('adjusting PAID order to SETTLED keeps status PAID and updates settlementStatus', async () => {
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
  assert.equal('status' in updatedData, false)
  assert.equal(updatedData.pendingAmount, null)
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

