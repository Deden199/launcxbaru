import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

// Patch runManualSettlement before loading controller
const settlement = require('../src/cron/settlement')
let lastBatches: number | null = null
settlement.runManualSettlement = async (batches: number) => {
  lastBatches = batches
  return { settledOrders: 0, netAmount: 0 }
}

const { manualSettlement } = require('../src/controller/admin/settlement.controller')

const app = express()
app.use(express.json())
app.post('/settlement', (req, res) => {
  ;(req as any).userId = 'admin1'
  manualSettlement(req as any, res)
})

test('manual settlement passes batch count', async () => {
  lastBatches = null
  const res = await request(app).post('/settlement').send({ batches: 5 })
  assert.equal(res.status, 200)
  assert.equal(lastBatches, 5)
})

