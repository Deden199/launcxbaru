import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

import router from '../src/route/admin/clientUser.routes'
import { config } from '../src/config'
import { prisma } from '../src/core/prisma'

// Stub database interactions
(prisma as any).clientUser = {
  findUnique: async () => null,
  create: async ({ data }: any) => ({ id: 'new-id', email: data.email }),
  delete: async () => {},
}
;(prisma as any).adminLog = { create: async () => {} }

const app = express()
app.use(express.json())
app.use('/clients/:clientId/users', router)

const adminToken = jwt.sign({ sub: '1', role: 'ADMIN' }, config.api.jwtSecret)
const superToken = jwt.sign({ sub: '2', role: 'SUPER_ADMIN' }, config.api.jwtSecret)

test('admin user cannot create client user', async () => {
  const res = await request(app)
    .post('/clients/abc/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: 'test@example.com', password: 'pass' })

  assert.equal(res.status, 403)
})

test('super admin can create client user', async () => {
  const res = await request(app)
    .post('/clients/abc/users')
    .set('Authorization', `Bearer ${superToken}`)
    .send({ email: 'test@example.com', password: 'pass' })

  assert.equal(res.status, 201)
  assert.deepEqual(res.body, {
    id: 'new-id',
    email: 'test@example.com',
  })
})
