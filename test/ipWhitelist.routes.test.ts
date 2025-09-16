import './helpers/testEnv'
import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

import router from '../src/route/admin/ipWhitelist.routes'
import {
  adminIpWhitelist,
  globalIpWhitelist,
  refreshAdminIpWhitelist,
  refreshGlobalIpWhitelist,
} from '../src/middleware/ipWhitelist'
import { config } from '../src/config'
import { prisma } from '../src/core/prisma'

type SettingRow = { key: string; value: string }

let settings: Record<string, SettingRow | undefined> = {}

const uniqueError = () => Object.assign(new Error('Unique constraint'), { code: 'P2002' })

;(prisma as any).setting = {
  findUnique: async ({ where: { key } }: any) => settings[key] ?? null,
  upsert: async ({ where: { key }, update, create }: any) => {
    const value =
      typeof update?.value === 'string'
        ? update.value
        : typeof create?.value === 'string'
          ? create.value
          : ''
    settings[key] = { key, value }
    return settings[key]
  },
  create: async ({ data }: any) => {
    if (settings[data.key]) {
      throw uniqueError()
    }
    settings[data.key] = { key: data.key, value: data.value }
    return settings[data.key]
  },
}
;(prisma as any).adminLog = { create: async () => {} }
;(prisma as any).partnerUser = { findUnique: async () => null }

const app = express()
app.use(express.json())
app.use(globalIpWhitelist)
app.use('/admin/ip-whitelist', router)
app.get('/secure', adminIpWhitelist, (_req, res) => res.json({ ok: true }))
app.get('/public', (_req, res) => res.json({ ok: true }))

const superToken = jwt.sign({ sub: '1', role: 'SUPER_ADMIN' }, config.api.jwtSecret)

beforeEach(async () => {
  settings = {
    admin_ip_whitelist: { key: 'admin_ip_whitelist', value: '1.1.1.1' },
    global_ip_whitelist: { key: 'global_ip_whitelist', value: '' },
  }
  await refreshAdminIpWhitelist()
  await refreshGlobalIpWhitelist()
})

test('get and update whitelist and enforce middleware', async () => {
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

test('empty admin whitelist allows all', async () => {
  settings['admin_ip_whitelist'] = { key: 'admin_ip_whitelist', value: '' }
  await refreshAdminIpWhitelist()
  const res = await request(app).get('/secure').set('X-Forwarded-For', '5.5.5.5')
  assert.equal(res.status, 200)
})

test('global whitelist routes control all traffic', async () => {
  let res = await request(app)
    .get('/admin/ip-whitelist/global')
    .set('Authorization', `Bearer ${superToken}`)
  assert.deepEqual(res.body, { data: [] })

  res = await request(app).get('/public').set('X-Forwarded-For', '8.8.8.8')
  assert.equal(res.status, 200)

  res = await request(app)
    .put('/admin/ip-whitelist/global')
    .set('Authorization', `Bearer ${superToken}`)
    .send({ ips: ['9.9.9.9'] })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { data: ['9.9.9.9'] })

  res = await request(app)
    .get('/admin/ip-whitelist/global')
    .set('Authorization', `Bearer ${superToken}`)
    .set('X-Forwarded-For', '9.9.9.9')
  assert.deepEqual(res.body, { data: ['9.9.9.9'] })

  res = await request(app).get('/public').set('X-Forwarded-For', '9.9.9.9')
  assert.equal(res.status, 200)
  res = await request(app).get('/public').set('X-Forwarded-For', '8.8.8.8')
  assert.equal(res.status, 403)
})

test('refreshGlobalIpWhitelist creates missing setting', async () => {
  delete settings['global_ip_whitelist']
  await refreshGlobalIpWhitelist()
  assert.equal(settings['global_ip_whitelist']?.key, 'global_ip_whitelist')
  assert.equal(settings['global_ip_whitelist']?.value, '')
})
