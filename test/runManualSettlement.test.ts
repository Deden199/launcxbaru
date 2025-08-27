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
import nock from 'nock'
import { runManualSettlement, resetSettlementState } from '../src/cron/settlement'
import { prisma } from '../src/core/prisma'

test('runManualSettlement settles PAID orders', async () => {
  resetSettlementState()

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
            channel: 'oy',
            createdAt: new Date(Date.now() - 1000),
            subMerchant: { credentials: { merchantId: 'm1', secretKey: 's1' } }
          }
        ]
      }
      return []
    }
  }

  ;(prisma as any).$queryRaw = async () => [{ locked: true }]

  ;(prisma as any).$transaction = async (fn: any) =>
    fn({
      order: { updateMany: async () => ({ count: 1 }) },
      partnerClient: { update: async () => {} }
    })

  const scope1 = nock('https://partner.oyindonesia.com')
    .post('/api/payment-routing/check-status')
    .reply(200, {
      status: { code: '000' },
      trx_id: 'trx1',
      settlement_status: 'SETTLED'
    })
  const scope2 = nock('https://partner.oyindonesia.com')
    .get('/api/v1/transaction')
    .query(true)
    .reply(200, {
      status: { code: '000' },
      data: {
        settlement_amount: 100,
        admin_fee: { total_fee: 1 },
        settlement_time: new Date().toISOString()
      }
    })

  const result = await runManualSettlement()

  assert.equal(result.settledOrders, 1)
  assert.equal(result.netAmount, 100)
  scope1.done()
  scope2.done()
})

