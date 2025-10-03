process.env.JWT_SECRET = 'test'
delete process.env.HTTP_PROXY
delete process.env.http_proxy
delete process.env.HTTPS_PROXY
delete process.env.https_proxy
delete process.env.npm_config_proxy
delete process.env.npm_config_http_proxy
delete process.env.npm_config_https_proxy

import test from 'node:test'
import assert from 'node:assert/strict'
import { runManualSettlement, resetSettlementState } from '../src/cron/settlement'
import * as billing from '../src/service/billing'
import { prisma } from '../src/core/prisma'

test('runManualSettlement settles PAID orders', async () => {
  resetSettlementState()

  const movements: billing.BalanceMovementPayload[] = []
  const originalPost = billing.postBalanceMovement
  ;(billing as any).postBalanceMovement = async (payload: billing.BalanceMovementPayload) => {
    movements.push(payload)
  }

  let firstCall = true
  ;(prisma as any).order = {
    findMany: async () => {
      if (firstCall) {
        firstCall = false
        return [
          {
            id: 'o1',
            partnerClientId: 'pc1',
            pendingAmount: 100,
            amount: 150,
            channel: 'oy',
            createdAt: new Date(Date.now() - 1000),
            rrn: null,
            subMerchant: null,
            partnerClient: { id: 'pc1', feePercent: 1, feeFlat: 0 }
          }
        ]
      }
      return []
    },
    updateMany: async () => ({ count: 1 })
  }

  ;(prisma as any).$queryRaw = async () => [{ locked: true }]

  const orderUpdates: any[] = []
  const partnerUpdates: any[] = []
  ;(prisma as any).$transaction = async (fn: any) =>
    fn({
      order: {
        updateMany: async (args: any) => {
          orderUpdates.push(args)
          return { count: 1 }
        }
      },
      partnerClient: {
        update: async (args: any) => {
          partnerUpdates.push(args)
          return {}
        }
      }
    })

  const result = await runManualSettlement()

  assert.equal(result.settledOrders, 1)
  assert.equal(result.netAmount, 100)
  assert.equal(movements.length, 1)
  assert.deepEqual(movements[0], {
    partnerClientId: 'pc1',
    amount: 100,
    reference: 'SETTLE:o1',
    description: 'Manual settlement for order o1'
  })
  assert.equal(orderUpdates.length, 1)
  assert.equal(orderUpdates[0].data.status, 'SETTLED')
  assert.equal(orderUpdates[0].data.settlementAmount, 100)
  assert.equal(orderUpdates[0].data.settlementStatus, 'MANUAL')
  assert.ok(orderUpdates[0].data.settlementTime instanceof Date)
  assert.equal(partnerUpdates.length, 1)
  assert.deepEqual(partnerUpdates[0], {
    where: { id: 'pc1' },
    data: { balance: { increment: 100 } }
  })

  ;(billing as any).postBalanceMovement = originalPost
})

