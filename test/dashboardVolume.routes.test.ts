import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

import { prisma } from '../src/core/prisma'
const { getDashboardVolume } = require('../src/controller/admin/merchant.controller')

test('getDashboardVolume returns buckets', async () => {
  const paidAt = new Date()
  ;(prisma as any).$queryRaw = async () => [
    { bucket: paidAt, totalAmount: 100, count: 2 },
  ]
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')
    .query({ granularity: 'hour' })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, {
    buckets: [
      {
        bucket: paidAt.toISOString(),
        totalAmount: 100,
        count: 2,
      },
    ],
  })
})

