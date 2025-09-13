import test from 'node:test'
import assert from 'node:assert/strict'
process.env.JWT_SECRET = 'test'

import { withdrawalCallback } from '../src/controller/withdrawals.controller'
import { prisma } from '../src/core/prisma'

test('withdrawalCallback adjusts balance only on valid status transitions', async () => {
  let status = 'PENDING'
  let balance = 0

  ;(prisma as any).withdrawRequest = {
    findUnique: async () => ({ amount: 100, partnerClientId: 'pc1', status }),
    updateMany: async ({ where, data }: any) => {
      if (where.refId === 'w1' && where.status?.in.includes(status)) {
        status = data.status
        return { count: 1 }
      }
      return { count: 0 }
    }
  }
  ;(prisma as any).partnerClient = {
    update: async ({ data }: any) => {
      if (data.balance.increment) balance += data.balance.increment
      if (data.balance.decrement) balance -= data.balance.decrement
    }
  }

  const makeRes = (): any => ({
    status: (_: number) => ({ json: (_payload: any) => {} })
  })

  const failedReq: any = {
    rawBody: Buffer.from(JSON.stringify({ ref_id: 'w1', status: 'FAILED' })),
    header: () => ''
  }

  // PENDING -> FAILED: refund once
  await withdrawalCallback(failedReq as any, makeRes())
  assert.equal(balance, 100)

  // duplicate FAILED callback: no extra refund
  await withdrawalCallback(failedReq as any, makeRes())
  assert.equal(balance, 100)

  const completedReq: any = {
    rawBody: Buffer.from(JSON.stringify({ ref_id: 'w1', status: 'SUCCESS' })),
    header: () => ''
  }

  // FAILED -> COMPLETED: balance deducted
  await withdrawalCallback(completedReq as any, makeRes())
  assert.equal(balance, 0)

  // duplicate COMPLETED callback: no extra deduction
  await withdrawalCallback(completedReq as any, makeRes())
  assert.equal(balance, 0)
})

