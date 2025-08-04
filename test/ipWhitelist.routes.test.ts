import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

import router from '../src/route/admin/ipWhitelist.routes'
import { adminIpWhitelist, refreshAdminIpWhitelist } from '../src/middleware/ipWhitelist'
import { config } from '../src/config'
import { prisma } from '../src/core/prisma'

let currentSetting: { key: string; value: string | null } | null = {
  key: 'admin_ip_whitelist',
  value: '1.1.1.1',
}

;(prisma as any).setting = {
  findUnique: async () => currentSetting,
  upsert: async ({ where, update, create }: any) => {
    const value = update?.value ?? create?.value
    currentSetting = { key: where.key, value }
    return currentSetting
  },
}
;(prisma as any).adminLog = { create: async () => {} }

const app = express()
app.use(express.json())
app.use('/admin/ip-whitelist', router)
app.get('/secure', adminIpWhitelist, (_req, res) => res.json({ ok: true }))

const superToken = jwt.sign({ sub: '1', role: 'SUPER_ADMIN' }, config.api.jwtSecret)

test('get and update whitelist and enforce middleware', async () => {
  await refreshAdminIpWhitelist()
  let res = await request(app)
    .get('/admin/ip-whitelist')
    .set('Authorization', `Bearer ${superToken}`)
  assert.deepEqual(res.body, { data: ['1.1.1.1'] })

  res = await request(app).get('/secure').set('X-Forwarded-For', '1.1.1.1')
  assert.equal(res.status, 200)

  res = await request(app).get('/secure').set('X-Forwarded-For', '2.2.2.2')
  assert.equal(res.status, 403)

  res = await request(app)
    .put('/admin/ip-whitelist')
    .set('Authorization', `Bearer ${superToken}`)
    .send({ ips: ['2.2.2.2'] })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { data: ['2.2.2.2'] })

  res = await request(app).get('/secure').set('X-Forwarded-For', '2.2.2.2')
  assert.equal(res.status, 200)
  res = await request(app).get('/secure').set('X-Forwarded-For', '1.1.1.1')
  assert.equal(res.status, 403)
})

test('empty whitelist allows all', async () => {
  currentSetting = { key: 'admin_ip_whitelist', value: '' }
  await refreshAdminIpWhitelist()
  const res = await request(app).get('/secure').set('X-Forwarded-For', '5.5.5.5')
  assert.equal(res.status, 200)
})

