process.env.JWT_SECRET = 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:memory:?schema=public'

import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import type { AxiosResponse } from 'axios'

import { processCallbackJobs } from '../src/worker/callbackQueue'
import * as postWithRetryModule from '../src/utils/postWithRetry'
import { prisma } from '../src/core/prisma'

test('callback jobs are retried after rate limiting', async (t) => {
  const job = {
    id: 'job_1',
    url: 'https://example.com/callback',
    payload: { foo: 'bar' },
    signature: 'signature',
    attempts: 0,
    delivered: false,
    partnerClientId: 'partner-1',
    lastError: null as any,
    responseBody: null as any,
  }

  let deadLetterCalled = false
  let jobDeleted = false
  let postCallCount = 0

  const postWithRetryMock = mock.method(
    postWithRetryModule,
    'postWithRetry',
    async () => {
      postCallCount += 1
      if (postCallCount === 1) {
        const error: any = new Error('Too Many Requests')
        error.response = {
          status: 429,
          data: { error: 'rate limited' },
          headers: { 'retry-after': '1' },
        }
        throw error
      }
      const successResponse = {
        status: 200,
        statusText: 'OK',
        data: { success: true },
        headers: {},
        config: {} as any,
      } as AxiosResponse
      return successResponse
    }
  )

  const originalFindMany = prisma.callbackJob.findMany
  const originalUpdate = prisma.callbackJob.update
  const originalDelete = prisma.callbackJob.delete
  const originalDeadLetterCreate = prisma.callbackJobDeadLetter.create

  ;(prisma.callbackJob as any).findMany = async () => {
    if (job.delivered) {
      return []
    }
    return [{ ...job }]
  }

  ;(prisma.callbackJob as any).update = async ({ data }: any) => {
    if (typeof data.attempts === 'number') {
      job.attempts = data.attempts
    }
    if (Object.prototype.hasOwnProperty.call(data, 'delivered')) {
      job.delivered = data.delivered
    }
    if (Object.prototype.hasOwnProperty.call(data, 'lastError')) {
      job.lastError = data.lastError
    }
    if (Object.prototype.hasOwnProperty.call(data, 'responseBody')) {
      job.responseBody = data.responseBody
    }
    return { ...job }
  }

  ;(prisma.callbackJob as any).delete = async () => {
    jobDeleted = true
  }

  ;(prisma.callbackJobDeadLetter as any).create = async () => {
    deadLetterCalled = true
  }

  t.after(() => {
    postWithRetryMock.mock.restore()
    ;(prisma.callbackJob as any).findMany = originalFindMany
    ;(prisma.callbackJob as any).update = originalUpdate
    ;(prisma.callbackJob as any).delete = originalDelete
    ;(prisma.callbackJobDeadLetter as any).create = originalDeadLetterCreate
  })

  await processCallbackJobs()
  assert.equal(postCallCount, 1)
  assert.equal(job.delivered, false)
  assert.equal(job.attempts, 1)
  assert.equal(deadLetterCalled, false)
  assert.equal(jobDeleted, false)
  assert.ok(job.lastError, 'lastError should be recorded after rate limit')

  await processCallbackJobs()
  assert.equal(postCallCount, 2)
  assert.equal(job.delivered, true)
  assert.equal(job.attempts, 2)
  assert.equal(deadLetterCalled, false)
  assert.equal(jobDeleted, false)
  assert.equal(job.lastError, null)
})
