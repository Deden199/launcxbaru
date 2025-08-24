import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

import { prisma } from '../src/core/prisma'
const { getDashboardVolume } = require('../src/controller/admin/merchant.controller')

test('getDashboardVolume returns raw transactions', async () => {
  const paidAt = new Date()
  const createdAt = new Date(paidAt.getTime() - 60_000)
  ;(prisma as any).order = {
    findMany: async () => [
      {
        id: '1',
        createdAt,
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
        paymentReceivedTime: paidAt,
        settlementTime: paidAt,
        trxExpirationTime: paidAt,
      },
    ],
  }
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')
    .query({ date_from: paidAt.toISOString(), date_to: paidAt.toISOString() })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, {
    transactions: [
      {
        id: '1',
        date: paidAt.toISOString(),
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
        paymentReceivedTime: paidAt.toISOString(),
        settlementTime: paidAt.toISOString(),
        trxExpirationTime: paidAt.toISOString(),
      },
    ],
  })
})

