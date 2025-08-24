import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

import { prisma } from '../src/core/prisma'
const { getDashboardVolume } = require('../src/controller/admin/merchant.controller')

test('getDashboardVolume returns raw transactions', async () => {
  const now = new Date()
  ;(prisma as any).order = {
    findMany: async () => [
      {
        id: '1',
        createdAt: now,
        playerId: 'p1',
        qrPayload: 'ref1',
        rrn: 'rrn1',
        amount: 100,
        feeLauncx: 1,
        fee3rdParty: 2,
        pendingAmount: 50,
        settlementAmount: 40,
        status: 'PAID',
        settlementStatus: 'DONE',
        channel: 'QR',
        paymentReceivedTime: now,
        settlementTime: now,
        trxExpirationTime: now,
      },
    ],
  }
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')
    .query({ date_from: now.toISOString(), date_to: now.toISOString() })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, {
    transactions: [
      {
        id: '1',
        date: now.toISOString(),
        reference: 'ref1',
        rrn: 'rrn1',
        playerId: 'p1',
        amount: 100,
        feeLauncx: 1,
        feePg: 2,
        netSettle: 50,
        status: 'PAID',
        settlementStatus: 'DONE',
        channel: 'QR',
        paymentReceivedTime: now.toISOString(),
        settlementTime: now.toISOString(),
        trxExpirationTime: now.toISOString(),
      },
    ],
  })
})

