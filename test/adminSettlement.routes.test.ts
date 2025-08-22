import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

// Patch runManualSettlement before loading controller
const settlement = require('../src/cron/settlement')
let called = 0
settlement.runManualSettlement = async () => {
  called++
  return { settledOrders: 0, netAmount: 0 }
}

import * as adminLog from '../src/util/adminLog'
;(adminLog as any).logAdminAction = async () => {}

const { manualSettlement } = require('../src/controller/admin/settlement.controller')

const app = express()
app.use(express.json())
app.post('/settlement', (req, res) => {
  ;(req as any).userId = 'admin1'
  manualSettlement(req as any, res)
})

test('manual settlement runs without batches param', async () => {
  called = 0
  const res = await request(app).post('/settlement').send({ batches: 5 })
  assert.equal(res.status, 200)
  assert.equal(called, 1)
})

