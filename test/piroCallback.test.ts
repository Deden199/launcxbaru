import test from 'node:test'
import assert from 'node:assert/strict'

import './helpers/testEnv'

import crypto from 'crypto'

import { piroTransactionCallback } from '../src/controller/payment'
import { prisma } from '../src/core/prisma'

const signatureKey = process.env.PIRO_SIGNATURE_KEY || 'piro-signature'

test.afterEach(() => {
  ;(prisma as any).order = undefined
  ;(prisma as any).partnerClient = undefined
  ;(prisma as any).transaction_callback = undefined
  ;(prisma as any).callbackJob = undefined
})

test('piroTransactionCallback rejects invalid signature', { concurrency: false }, async () => {
  const payload = { reference_id: 'order-1', status: 'PAID', amount: 1000 }
  const raw = JSON.stringify(payload)

  let result: any = null
  const req: any = {
    rawBody: Buffer.from(raw, 'utf8'),
    header: (name: string) => {
      if (name.toLowerCase().includes('signature')) return 'invalid'
      return undefined
    },
  }
  const res: any = {
    status(code: number) {
      return {
        json(body: any) {
          result = { code, body }
        },
      }
    },
  }

  await piroTransactionCallback(req, res)
  assert.ok(result, 'response should be captured')
  assert.equal(result.code, 400)
  assert.match(result.body.error, /signature/i)
})

test('piroTransactionCallback processes valid payload', { concurrency: false }, async () => {
  const payload = {
    reference_id: 'order-123',
    payment_id: 'pi-1',
    status: 'PAID',
    amount: 12500,
  }
  const raw = JSON.stringify(payload)
  const signature = crypto.createHash('md5').update(raw + signatureKey, 'utf8').digest('hex')

  let orderFindCount = 0
  let capturedUpdate: any = null
  let callbackJobPayload: any = null

  ;(prisma as any).order = {
    findUnique: async () => {
      orderFindCount += 1
      if (orderFindCount >= 2) {
        return {
          amount: 12500,
          feeLauncx: 0,
          pendingAmount: 12500,
          qrPayload: null,
        }
      }
      return {
        status: 'PENDING',
        userId: 'partner-1',
        partnerClientId: 'partner-1',
        amount: 12500,
        qrPayload: null,
      }
    },
    update: async (args: any) => {
      capturedUpdate = args
      return {}
    },
  }

  ;(prisma as any).partnerClient = {
    findUnique: async () => ({
      feePercent: 0,
      feeFlat: 0,
      weekendFeePercent: 0,
      weekendFeeFlat: 0,
      callbackUrl: 'https://example.com/callback',
      callbackSecret: 'cb-secret',
    }),
  }

  ;(prisma as any).transaction_callback = {
    findFirst: async () => null,
    create: async () => {},
  }

  ;(prisma as any).callbackJob = {
    create: async (args: any) => {
      callbackJobPayload = args
    },
  }

  let result: any = null
  const req: any = {
    rawBody: Buffer.from(raw, 'utf8'),
    header(name: string) {
      if (name.toLowerCase().includes('signature')) return signature
      return undefined
    },
  }
  const res: any = {
    status(code: number) {
      return {
        json(body: any) {
          result = { code, body }
        },
      }
    },
  }

  await piroTransactionCallback(req, res)

  assert.equal(result.code, 200)
  assert.ok(capturedUpdate, 'order update should be called')
  assert.equal(capturedUpdate.data.status, 'PAID')
  assert.ok(callbackJobPayload, 'callback job should be enqueued')
  assert.equal(callbackJobPayload.data.url, 'https://example.com/callback')
})
