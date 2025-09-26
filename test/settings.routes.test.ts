import './helpers/testEnv'

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

import settingsRoutes from '../src/route/settings.routes'
import { config } from '../src/config'
import { prisma } from '../src/core/prisma'
import * as adminLog from '../src/util/adminLog'

// Patch restartSettlementChecker before loading controller
const settlement = require('../src/cron/settlement')
let lastCron: string | null = null
settlement.restartSettlementChecker = (expr: string) => { lastCron = expr }

const { updateSettings } = require('../src/controller/settings.controller')

type SettingRow = { key: string; value: string }

let settingsStore: Record<string, SettingRow> = {}

const resetSettingsStore = (initial: Record<string, string> = {}) => {
  settingsStore = {}
  for (const [key, value] of Object.entries(initial)) {
    settingsStore[key] = { key, value }
  }
}

;(prisma as any).setting = {
  findMany: async () => Object.values(settingsStore),
  upsert: async ({ where, update, create }: any) => {
    const value = update?.value ?? create?.value ?? ''
    const row = { key: where.key, value }
    settingsStore[where.key] = row
    return row
  }
}
;(prisma as any).$transaction = async (ops: any[]) => Promise.all(ops)
;(adminLog as any).logAdminAction = async () => {}

const app = express()
app.use(express.json())
app.put('/settings', (req, res) => {
  ;(req as any).userId = 'admin1'
  updateSettings(req as any, res)
})

const adminApp = express()
adminApp.use(express.json())
adminApp.use('/api/v1/admin/settings', settingsRoutes)

const superToken = jwt.sign({ sub: 'super-1', role: 'SUPER_ADMIN' }, config.api.jwtSecret)

beforeEach(() => {
  resetSettingsStore()
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

test('SUPER_ADMIN token can read admin settings', async () => {
  resetSettingsStore({ example: 'value' })
  const res = await request(adminApp)
    .get('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${superToken}`)

  assert.equal(res.status, 200)
  assert.equal(res.body.data.example, 'value')
  assert.equal(res.body.data.settlement_cron, '0 16 * * *')
})

test('SUPER_ADMIN token can update admin settings', async () => {
  lastCron = null
  const res = await request(adminApp)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${superToken}`)
    .send({ settlement_cron: '0 15 * * *' })

  assert.equal(res.status, 200)
  assert.equal(lastCron, '0 15 * * *')
  assert.equal(settingsStore['settlement_cron']?.value, '0 15 * * *')
})
