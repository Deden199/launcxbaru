import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import 'express-async-errors'
import { errorHandler } from '../src/middleware/errorHandler'

test('async route errors return 500', async () => {
  const app = express()
  app.get('/fail', async () => {
    throw new Error('boom')
  })
  app.use(errorHandler)

  const res = await request(app).get('/fail')
  assert.equal(res.status, 500)
  assert.deepEqual(res.body, { error: 'Internal Server Error' })
})
