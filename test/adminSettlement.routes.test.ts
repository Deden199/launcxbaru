import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

// Patch runManualSettlement before loading controller
const settlement = require('../src/cron/settlement')
let called = 0
settlement.runManualSettlement = async (opts?: any) => {
  called++
  opts?.onProgress?.({ settledOrders: 2, netAmount: 200, batchSettled: 2, batchAmount: 200 })
  return { settledOrders: 2, netAmount: 200 }
}
settlement.restartSettlementChecker = () => {}

import * as adminLog from '../src/util/adminLog'
;(adminLog as any).logAdminAction = async () => {}

const {
  manualSettlement,
  startSettlement,
  settlementStatus,
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
app.get('/settlement/status/:jobId', (req, res) => {
  settlementStatus(req as any, res)
})

test('manual settlement runs without batches param', async () => {
  called = 0
  const res = await request(app).post('/settlement').send({ batches: 5 })
  assert.equal(res.status, 200)
  assert.equal(called, 1)
})

test('start and check settlement job status', async () => {
  const startRes = await request(app).post('/settlement/start').send({})
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

