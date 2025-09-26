process.env.JWT_SECRET = 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:memory:?schema=public'

import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import type { AxiosResponse } from 'axios'

import { processCallbackJobs } from '../src/worker/callbackQueue'
import { config } from '../src/config'
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

  const findManyArgs: any[] = []

  ;(prisma.callbackJob as any).findMany = async (args: any) => {
    findManyArgs.push(args)
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
  assert.deepEqual(
    findManyArgs[findManyArgs.length - 1]?.where?.partnerClientId,
    { not: null },
    'findMany should filter out legacy rows without partnerClientId'
  )

  await processCallbackJobs()
  assert.equal(postCallCount, 2)
  assert.equal(job.delivered, true)
  assert.equal(job.attempts, 2)
  assert.equal(deadLetterCalled, false)
  assert.equal(jobDeleted, false)
  assert.equal(job.lastError, null)
  assert.deepEqual(
    findManyArgs[findManyArgs.length - 1]?.where?.partnerClientId,
    { not: null },
    'findMany should keep enforcing the partnerClientId filter'
  )
})

test(
  'callback jobs respect concurrency limit and dead-letter failures',
  async (t) => {
    const originalConcurrency = config.api.callbackQueue.concurrency
    config.api.callbackQueue.concurrency = 2

    const jobs = new Map([
      [
        'job-success-1',
        {
          id: 'job-success-1',
          url: 'https://example.com/callback-1',
          payload: { id: 'job-success-1' },
          signature: 'signature-1',
          attempts: 0,
          delivered: false,
          partnerClientId: 'partner-1',
          lastError: null as any,
          responseBody: null as any,
          createdAt: new Date(1),
        },
      ],
      [
        'job-failure',
        {
          id: 'job-failure',
          url: 'https://example.com/callback-2',
          payload: { id: 'job-failure' },
          signature: 'signature-2',
          attempts: 0,
          delivered: false,
          partnerClientId: 'partner-2',
          lastError: null as any,
          responseBody: null as any,
          createdAt: new Date(2),
        },
      ],
      [
        'job-success-2',
        {
          id: 'job-success-2',
          url: 'https://example.com/callback-3',
          payload: { id: 'job-success-2' },
          signature: 'signature-3',
          attempts: 0,
          delivered: false,
          partnerClientId: 'partner-3',
          lastError: null as any,
          responseBody: null as any,
          createdAt: new Date(3),
        },
      ],
    ])

    const deadLetterEntries: any[] = []
    let active = 0
    let maxActive = 0

    const delays: Record<string, number> = {
      'job-success-1': 30,
      'job-failure': 40,
      'job-success-2': 10,
    }

    const postWithRetryMock = mock.method(
      postWithRetryModule,
      'postWithRetry',
      async (_url, payload: { id: string }) => {
        active += 1
        maxActive = Math.max(maxActive, active)

        const jobId = payload.id

        return new Promise((resolve, reject) => {
          setTimeout(() => {
            active -= 1
            if (jobId === 'job-failure') {
              const error: any = new Error('Bad Request')
              error.response = { status: 400, data: { error: 'bad request' } }
              reject(error)
            } else {
              resolve({
                status: 200,
                statusText: 'OK',
                data: { success: true },
                headers: {},
                config: {} as any,
              } as AxiosResponse)
            }
          }, delays[jobId])
        })
      }
    )

    const originalFindMany = prisma.callbackJob.findMany
    const originalUpdate = prisma.callbackJob.update
    const originalDelete = prisma.callbackJob.delete
    const originalDeadLetterCreate = prisma.callbackJobDeadLetter.create

    ;(prisma.callbackJob as any).findMany = async () => {
      return Array.from(jobs.values())
        .filter((job: any) => !job.delivered)
        .map((job: any) => ({ ...job }))
    }

    ;(prisma.callbackJob as any).update = async ({ where, data }: any) => {
      const job = jobs.get(where.id)
      if (!job) return null

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

    ;(prisma.callbackJob as any).delete = async ({ where }: any) => {
      jobs.delete(where.id)
    }

    ;(prisma.callbackJobDeadLetter as any).create = async ({ data }: any) => {
      deadLetterEntries.push(data)
    }

    t.after(() => {
      postWithRetryMock.mock.restore()
      ;(prisma.callbackJob as any).findMany = originalFindMany
      ;(prisma.callbackJob as any).update = originalUpdate
      ;(prisma.callbackJob as any).delete = originalDelete
      ;(prisma.callbackJobDeadLetter as any).create = originalDeadLetterCreate
      config.api.callbackQueue.concurrency = originalConcurrency
    })

    await processCallbackJobs()

    assert.equal(maxActive, 2, 'should run jobs in parallel up to limit')
    assert.equal(jobs.get('job-success-1')?.delivered, true)
    assert.equal(jobs.get('job-success-2')?.delivered, true)
    assert.equal(jobs.get('job-failure'), undefined, 'failed job should be removed')
    assert.equal(deadLetterEntries.length, 1)
    assert.equal(deadLetterEntries[0].jobId, 'job-failure')
  }
)
