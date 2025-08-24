import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

import { prisma } from '../src/core/prisma'
const { getDashboardVolume } = require('../src/controller/admin/merchant.controller')

test('getDashboardVolume returns buckets', async () => {
  const paidBucket = new Date().toISOString()
  ;(prisma as any).order.aggregateRaw = async () => [
    { _id: paidBucket, totalAmount: 100, count: 2 },
  ]
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, {
    buckets: [
      {
        bucket: paidBucket,
        totalAmount: 100,
        count: 2,
      },
    ],
  })
})

test('getDashboardVolume filters null buckets', async () => {
  ;(prisma as any).order.aggregateRaw = async () => [
    { _id: null, totalAmount: 50, count: 1 },
  ]
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { buckets: [] })
})

