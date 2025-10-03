import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

// Patch runManualSettlement before loading controller
const settlement = require('../src/cron/settlement')
let called = 0
settlement.runManualSettlement = async (cb?: any) => {
  called++
  cb?.({ settledOrders: 2, netAmount: 200, batchSettled: 2, batchAmount: 200, batchesProcessed: 1 })
  return { settledOrders: 2, netAmount: 200, batches: 1, cancelled: false }
}
settlement.restartSettlementChecker = () => {}

import * as adminLog from '../src/util/adminLog'
;(adminLog as any).logAdminAction = async () => {}

const {
  manualSettlement,
  startSettlement,
  settlementStatus,
  previewSettlement,
  cancelSettlement,
} = require('../src/controller/admin/settlement.controller')

const app = express()
app.use(express.json())
app.post('/settlement', (req, res) => {
  ;(req as any).userId = 'admin1'
  manualSettlement(req as any, res)
})
app.post('/settlement/start', (req, res) => {
  ;(req as any).userId = 'admin1'
  startSettlement(req as any, res)
})
app.post('/settlement/preview', (req, res) => {
  previewSettlement(req as any, res)
})
app.get('/settlement/status/:jobId', (req, res) => {
  settlementStatus(req as any, res)
})
app.post('/settlement/cancel/:jobId', (req, res) => {
  cancelSettlement(req as any, res)
})

const baseFilters = {
  dateFrom: '2024-01-01',
  dateTo: '2024-01-02',
  daysOfWeek: [1],
  hourStart: 0,
  hourEnd: 23,
}

test('manual settlement runs without batches param', async () => {
  called = 0
  const res = await request(app).post('/settlement').send({ batches: 5 })
  assert.equal(res.status, 200)
  assert.equal(called, 1)
})

test('preview settlement with filters', async () => {
  const res = await request(app).post('/settlement/preview').send({ filters: baseFilters })
  assert.equal(res.status, 200)
  assert.ok(res.body.data.preview)
})

test('start and check settlement job status', async () => {
  const startRes = await request(app).post('/settlement/start').send({ filters: baseFilters })
  assert.equal(startRes.status, 200)
  const jobId = startRes.body.data.jobId
  assert.ok(jobId)

  await new Promise(r => setTimeout(r, 10))

  const statusRes = await request(app).get(`/settlement/status/${jobId}`)
  assert.equal(statusRes.status, 200)
  assert.equal(statusRes.body.data.settledOrders, 2)
  assert.equal(statusRes.body.data.netAmount, 200)
  assert.equal(statusRes.body.data.status, 'completed')
})

