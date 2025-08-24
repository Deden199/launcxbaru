import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

import { prisma } from '../src/core/prisma'
const { getDashboardVolume } = require('../src/controller/admin/merchant.controller')

test('getDashboardVolume returns points', async () => {
  const ts = new Date().toISOString()
  let receivedPipeline: any[] | undefined
  ;(prisma as any).order.aggregateRaw = async (args: any) => {
    receivedPipeline = args.pipeline
    return [{ timestamp: ts, totalAmount: 100, count: 2 }]
  }
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, {
    points: [
      {
        timestamp: ts,
        totalAmount: 100,
        count: 2,
      },
    ],
  })
  assert(receivedPipeline?.some(s => s.$project?.timestamp?.$dateTrunc))
  assert(receivedPipeline?.some(s => s.$group?.count))
  assert(receivedPipeline?.[0]?.$addFields?.baseTime?.$toDate)
  assert(receivedPipeline?.[1]?.$match?.baseTime)
  assert(receivedPipeline?.[1]?.$match?.status?.$in)
})

test('getDashboardVolume handles empty result', async () => {
  ;(prisma as any).order.aggregateRaw = async () => []
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { points: [] })
})

