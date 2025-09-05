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

