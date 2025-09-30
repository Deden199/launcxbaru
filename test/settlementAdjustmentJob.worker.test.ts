import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import moment from 'moment-timezone'

process.env.JWT_SECRET = 'test'

const prismaPath = require.resolve('../src/core/prisma')
const prismaMock: any = {
  order: {
    findMany: async () => [],
    updateMany: async () => ({ count: 0 }),
  },
  transaction_request: {
    findMany: async () => [],
    update: async () => ({}),
  },
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

const {
  startSettlementAdjustmentJob,
  settlementAdjustmentStatus,
} = require('../src/controller/admin/settlementAdjustment.controller')
const {
  runSettlementAdjustmentJob,
} = require('../src/service/settlementAdjustmentJob')

const app = express()
app.use(express.json())
app.post('/settlement/adjust/job', (req, res) => {
  ;(req as any).userId = 'admin1'
  startSettlementAdjustmentJob(req as any, res)
})
app.get('/settlement/adjust/job/:jobId', (req, res) => {
  settlementAdjustmentStatus(req as any, res)
})

test('job creation enqueues worker and reports completion', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  prisma.order.findMany = async () => [
    { id: 'o1', amount: 100, fee3rdParty: 0, feeLauncx: 0, subMerchantId: 'sub-1' },
    { id: 'o2', amount: 200, fee3rdParty: 10, feeLauncx: 5, subMerchantId: 'sub-1' },
  ]
  prisma.transaction_request.findMany = async () => []
  const orderUpdates: any[] = []
  prisma.order.updateMany = async (args: any) => {
    orderUpdates.push(args)
    return { count: 1 }
  }

  const res = await request(app)
    .post('/settlement/adjust/job')
    .send({
      subMerchantId: 'sub-1',
      settled_from: '2024-02-10',
      settled_to: '2024-02-11',
      settlementStatus: 'SETTLED',
    })

  assert.equal(res.status, 202)
  assert.ok(res.body.id)
  const jobId = res.body.id

  let statusRes
  for (let attempt = 0; attempt < 10; attempt++) {
    statusRes = await request(app).get(`/settlement/adjust/job/${jobId}`)
    if (statusRes.body.status === 'completed') break
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  assert.equal(statusRes!.status, 200)
  assert.equal(statusRes!.body.status, 'completed')
  assert.equal(statusRes!.body.progress.processed, 2)
  assert.equal(statusRes!.body.progress.total, 2)
  assert.equal(statusRes!.body.totals.updatedOrders, 2)
  assert.equal(statusRes!.body.totals.totalOrders, 2)
  assert.equal(statusRes!.body.range.start <= statusRes!.body.range.end, true)
  assert.equal(orderUpdates.length, 4)
})

test('runSettlementAdjustmentJob converts range to Asia/Jakarta boundaries', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  let capturedWhere: any
  prisma.order.findMany = async ({ where }: any) => {
    capturedWhere = where
    return []
  }
  prisma.transaction_request.findMany = async () => []

  const summary = await runSettlementAdjustmentJob({
    subMerchantId: 'sub-1',
    settlementStatus: 'SETTLED',
    start: '2024-03-01T10:00:00Z',
    end: '2024-03-05T10:00:00Z',
  })

  const expectedStart = moment.tz('2024-03-01T10:00:00Z', 'Asia/Jakarta').startOf('day')
  const expectedEnd = moment.tz('2024-03-05T10:00:00Z', 'Asia/Jakarta').endOf('day')

  assert.equal(capturedWhere.createdAt.gte.toISOString(), expectedStart.toDate().toISOString())
  assert.equal(capturedWhere.createdAt.lte.toISOString(), expectedEnd.toDate().toISOString())
  assert.equal(summary.startBoundary.toISOString(), expectedStart.toDate().toISOString())
  assert.equal(summary.endBoundary.toISOString(), expectedEnd.toDate().toISOString())
})

test('service only updates records for requested sub-merchant', async () => {
  const prisma = require.cache[prismaPath].exports.prisma
  prisma.order.findMany = async () => [
    { id: 'o1', amount: 100, fee3rdParty: 0, feeLauncx: 0, subMerchantId: 'sub-1' },
  ]
  prisma.transaction_request.findMany = async () => []
  let capturedUpdateWhere: any
  prisma.order.updateMany = async ({ where }: any) => {
    capturedUpdateWhere = where
    return { count: 1 }
  }

  await runSettlementAdjustmentJob({
    subMerchantId: 'sub-1',
    settlementStatus: 'SETTLED',
    start: '2024-04-01',
    end: '2024-04-02',
  })

  assert.equal(capturedUpdateWhere.subMerchantId, 'sub-1')
})
