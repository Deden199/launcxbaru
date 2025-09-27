import test from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test'

import './helpers/testEnv'

import crypto from 'crypto'

import { piroWithdrawalCallback } from '../src/controller/withdrawals.controller'
import { prisma } from '../src/core/prisma'
import { config } from '../src/config'

config.api.piro.signatureKey = 'piro-signature'

test('piroWithdrawalCallback rejects invalid signature', async () => {
  const req: any = {
    rawBody: JSON.stringify({ referenceId: 'wd-1', status: 'SUCCESS' }),
    header: (name: string) => (name.toLowerCase() === 'x-piro-signature' ? 'bad' : ''),
  }

  const captured: any[] = []
  const res: any = {
    status(code: number) {
      captured.push(code)
      return {
        json(payload: any) {
          captured.push(payload.error)
        },
      }
    },
    json() {
      captured.push('unexpected')
    },
  }

  await piroWithdrawalCallback(req, res)
  assert.equal(captured[0], 400)
  assert.equal(captured[1], 'Invalid signature')
})

test('piroWithdrawalCallback updates pending withdrawal', async () => {
  let statusStore = 'PENDING'
  let pgId: string | undefined
  let feeStore: number | undefined
  let balanceChange = 0

  ;(prisma as any).withdrawRequest = {
    findUnique: async () => ({ status: statusStore, partnerClientId: 'pc-1', amount: 250000 }),
    updateMany: async ({ data }: any) => {
      statusStore = data.status
      pgId = data.paymentGatewayId
      feeStore = data.pgFee
      return { count: 1 }
    },
  }

  ;(prisma as any).partnerClient = {
    update: async ({ data }: any) => {
      if (data.balance?.increment) balanceChange += data.balance.increment
      if (data.balance?.decrement) balanceChange -= data.balance.decrement
    },
  }

  const body = {
    referenceId: 'wd-2',
    status: 'SUCCESS',
    disbursementId: 'piro-123',
    feeAmount: 1500,
    accountName: 'John Doe',
    bankName: 'Bank Mandiri',
  }

  const raw = JSON.stringify(body)
  const signature = crypto.createHash('md5').update(raw + config.api.piro.signatureKey, 'utf8').digest('hex')
  const req: any = {
    rawBody: raw,
    header: (name: string) => (name.toLowerCase() === 'x-piro-signature' ? signature : ''),
  }

  const res: any = {
    json(payload: any) {
      assert.deepEqual(payload, { ok: true })
    },
    status(code: number) {
      throw new Error(`unexpected status ${code}`)
    },
  }

  await piroWithdrawalCallback(req, res)
  assert.equal(statusStore, 'COMPLETED')
  assert.equal(pgId, 'piro-123')
  assert.equal(feeStore, 1500)
  assert.equal(balanceChange, 0)
})
