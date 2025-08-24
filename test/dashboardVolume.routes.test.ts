import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

process.env.JWT_SECRET = 'test'

const prisma = { order: { findMany: async () => [] } } as any
(require as any).cache[require.resolve('../src/core/prisma')] = { exports: { prisma } }
const { getDashboardVolume } = require('../src/controller/admin/merchant.controller')

test('getDashboardVolume groups orders', async () => {
  const orders = [
    {
      amount: 100,
      paymentReceivedTime: new Date('2023-01-01T00:10:00.000Z'),
      createdAt: new Date('2023-01-01T00:05:00.000Z'),
    },
    {
      amount: 200,
      paymentReceivedTime: null,
      createdAt: new Date('2023-01-01T00:50:00.000Z'),
    },
    {
      amount: 300,
      paymentReceivedTime: new Date('2023-01-01T01:20:00.000Z'),
      createdAt: new Date('2023-01-01T01:00:00.000Z'),
    },
  ]
  let receivedWhere: any
  ;(prisma as any).order.findMany = async (args: any) => {
    receivedWhere = args.where
    return orders
  }
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, {
    points: [
      { timestamp: '2023-01-01T00:00:00.000Z', totalAmount: 300, count: 2 },
      { timestamp: '2023-01-01T01:00:00.000Z', totalAmount: 300, count: 1 },
    ],
  })
  assert(receivedWhere?.AND?.some((f: any) => f.status?.in))
})

test('getDashboardVolume handles empty result', async () => {
  ;(prisma as any).order.findMany = async () => []
  const app = express()
  app.get('/dashboard/volume', getDashboardVolume)

  const res = await request(app)
    .get('/dashboard/volume')

  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { points: [] })
})

