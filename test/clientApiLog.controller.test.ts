import assert from 'node:assert/strict'
import test from 'node:test'
import { getClientApiLogs } from '../src/controller/clientApiLog.controller'
import { prisma } from '../src/core/prisma'

test('GET /api/v1/client/logs exposes last error details for pending jobs', async () => {
  const jobCreatedAt = new Date('2024-01-01T10:00:00.000Z')
  const jobUpdatedAt = new Date('2024-01-01T11:00:00.000Z')

  const lastError = {
    statusCode: 502,
    message: 'Bad gateway',
    timestamp: new Date('2024-01-01T11:00:00.000Z').toISOString(),
  }

  const callbackJobResponse = {
    id: 'job_1',
    attempts: 2,
    delivered: false,
    createdAt: jobCreatedAt,
    updatedAt: jobUpdatedAt,
    lastError,
    responseBody: { detail: 'upstream error' },
  }

  const deadLetterResponse: any[] = []

  const originalJobFindMany = prisma.callbackJob.findMany
  const originalJobCount = prisma.callbackJob.count
  const originalDeadLetterFindMany = prisma.callbackJobDeadLetter.findMany
  const originalDeadLetterCount = prisma.callbackJobDeadLetter.count

  ;(prisma.callbackJob as any).findMany = async () => [callbackJobResponse]
  ;(prisma.callbackJob as any).count = async () => 1
  ;(prisma.callbackJobDeadLetter as any).findMany = async () => deadLetterResponse
  ;(prisma.callbackJobDeadLetter as any).count = async () => 0

  const req: any = {
    partnerClientId: 'partner_1',
    childrenIds: [],
    query: {},
  }

  let payload: any
  const res: any = {
    json: (data: any) => {
      payload = data
      return data
    },
  }

  try {
    await getClientApiLogs(req, res)
  } finally {
    ;(prisma.callbackJob as any).findMany = originalJobFindMany
    ;(prisma.callbackJob as any).count = originalJobCount
    ;(prisma.callbackJobDeadLetter as any).findMany = originalDeadLetterFindMany
    ;(prisma.callbackJobDeadLetter as any).count = originalDeadLetterCount
  }

  assert.ok(payload, 'Expected controller to respond with JSON payload')
  assert.equal(payload.total, 1)
  assert.equal(payload.rows.length, 1)

  const row = payload.rows[0]
  assert.equal(row.id, 'job_1')
  assert.equal(row.status, 'PENDING')
  assert.equal(row.attempts, 2)
  assert.equal(row.statusCode, 502)
  assert.equal(row.errorMessage, 'Bad gateway')
  assert.deepEqual(row.responseBody, { detail: 'upstream error' })
})
