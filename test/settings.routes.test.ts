import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

import { prisma } from '../src/core/prisma'
import * as adminLog from '../src/util/adminLog'

// Patch restartSettlementChecker before loading controller
const settlement = require('../src/cron/settlement')
let lastCron: string | null = null
settlement.restartSettlementChecker = (expr: string) => { lastCron = expr }

const { updateSettings } = require('../src/controller/settings.controller')

;(prisma as any).setting = {
  upsert: async ({ where, update, create }: any) => ({ key: where.key, value: update?.value ?? create?.value })
}
;(prisma as any).$transaction = async (ops: any[]) => Promise.all(ops)
;(adminLog as any).logAdminAction = async () => {}

const app = express()
app.use(express.json())
app.put('/settings', (req, res) => {
  ;(req as any).userId = 'admin1'
  updateSettings(req as any, res)
})

test('accepts valid cron expression', async () => {
  lastCron = null
  const res = await request(app).put('/settings').send({ settlement_cron: '0 16 * * *' })
  assert.equal(res.status, 200)
  assert.equal(lastCron, '0 16 * * *')
})

test('rejects invalid cron expression', async () => {
  const res = await request(app).put('/settings').send({ settlement_cron: 'bad cron' })
  assert.equal(res.status, 400)
})

test('rejects sub-minute cron expression', async () => {
  const res = await request(app).put('/settings').send({ settlement_cron: '*/30 * * * * *' })
  assert.equal(res.status, 400)
})
