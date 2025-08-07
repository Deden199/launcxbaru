import test from 'node:test'
import assert from 'node:assert/strict'
import { oyTransactionCallback } from '../src/controller/payment'
import { prisma } from '../src/core/prisma'

test('oyTransactionCallback skips settled orders', async () => {
  let partnerCalled = false
  ;(prisma as any).transaction_callback = {
    findFirst: async () => null,
    create: async () => {}
  }
  ;(prisma as any).order = {
    findUnique: async () => ({ userId: 'pc1', status: 'SETTLED' })
  }
  ;(prisma as any).partnerClient = {
    findUnique: async () => { partnerCalled = true; return {} }
  }

  let result: any = null
  const req: any = {
    rawBody: Buffer.from(JSON.stringify({
      partner_trx_id: 'o1',
      payment_status: 'COMPLETE',
      receive_amount: 1000
    }))
  }
  const res: any = {
    status(code: number) {
      return {
        json(payload: any) {
          result = { code, payload }
        }
      }
    }
  }

  await oyTransactionCallback(req, res)
  assert.equal(result.code, 200)
  assert.equal(result.payload.result.message, 'Order already settled')
  assert.equal(partnerCalled, false)
})
