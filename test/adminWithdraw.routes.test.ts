import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { authenticator } from 'otplib'

process.env.JWT_SECRET = 'test'

import { prisma } from '../src/core/prisma'
import * as adminLog from '../src/util/adminLog'
import * as oyModule from '../src/service/oyClient'
const { adminWithdraw } = require('../src/controller/admin/merchant.controller')

const secret = authenticator.generateSecret()

;(prisma as any).partnerUser = {
  findUnique: async () => ({ totpEnabled: true, totpSecret: secret })
}
;(prisma as any).setting = { findUnique: async () => ({ value: null }) }
;(prisma as any).sub_merchant = {
  findUnique: async () => ({ credentials: { merchantId: 'm', secretKey: 'k' }, provider: 'oy' })
}
;(prisma as any).$transaction = async (fn: any) => {
  return fn({
    order: { aggregate: async () => ({ _sum: { settlementAmount: 100000 } }) },
    withdrawRequest: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    adminWithdraw: {
      aggregate: async () => ({ _sum: { amount: 0 } }),
      create: async () => {}
    }
  })
}
;(prisma as any).adminWithdraw = { update: async () => {} }
;(adminLog as any).logAdminAction = async () => {}

let lastDisburse: any = null
;(oyModule as any).OyClient = class {
  async disburse(payload: any) {
    lastDisburse = payload
    return { status: { code: '101' }, trx_id: 'trx' }
  }
}

const app = express()
app.use(express.json())
app.post('/withdraw', (req, res) => {
  ;(req as any).userId = 'admin1'
  adminWithdraw(req as any, res)
})

const basePayload = {
  subMerchantId: 'sub1',
  amount: 1000,
  bank_code: '001',
  account_number: '123',
  account_name: 'Test'
}

test('withdraw fails without otp', async () => {
  const res = await request(app).post('/withdraw').send(basePayload)
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'OTP wajib diisi')
})

test('withdraw fails with invalid otp', async () => {
  const res = await request(app).post('/withdraw').send({ ...basePayload, otp: '123456' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'OTP tidak valid')
})

test('withdraw succeeds with valid otp', async () => {
  const otp = authenticator.generate(secret)
  lastDisburse = null
  const res = await request(app).post('/withdraw').send({ ...basePayload, otp })
  assert.equal(res.status, 201)
  assert.deepEqual(res.body, { status: { code: '101' }, trx_id: 'trx' })
  assert.equal(lastDisburse.amount, basePayload.amount)
})

test('withdraw posts to provider even when balance insufficient', async () => {
  const otp = authenticator.generate(secret)
  lastDisburse = null
  const res = await request(app).post('/withdraw').send({ ...basePayload, amount: 200000, otp })
  assert.equal(res.status, 201)
  assert.deepEqual(res.body, { status: { code: '101' }, trx_id: 'trx' })
  assert.equal(lastDisburse.amount, 200000)
})
