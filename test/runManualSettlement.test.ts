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
import { prisma } from '../src/core/prisma'

test('runManualSettlement credits balance once and prevents double settlement', async () => {
  resetSettlementState()

  const originalOrder = (prisma as any).order
  const originalPartnerClient = (prisma as any).partnerClient
  const originalLedger = (prisma as any).partnerBalanceLedger
  const originalTx = (prisma as any).$transaction

  let orderStatus: 'PAID' | 'PROCESSING' | 'SETTLED' = 'PAID'
  let partnerBalance = 0
  let ledgerCreated = false
  let settlementAmount = 100
  let feeLauncx = 10
  let settlementTime: Date | null = null

  const baseOrder = {
    id: 'o1',
    partnerClientId: 'pc1',
    amount: 110,
    pendingAmount: settlementAmount,
    feeLauncx,
    fee3rdParty: 0,
    settlementStatus: null as string | null,
    settlementTime: null as Date | null,
    status: orderStatus,
    createdAt: new Date(Date.now() - 1000),
    partnerClient: { feePercent: 0, feeFlat: 0 },
  }

  ;(prisma as any).order = {
    findMany: async () => (orderStatus === 'PAID' ? [{ ...baseOrder, status: orderStatus }] : []),
    updateMany: async ({ data }: any) => {
      if (data.status === 'PROCESSING' && orderStatus === 'PAID') {
        orderStatus = 'PROCESSING'
        return { count: 1 }
      }
      if (data.status === 'PAID' && orderStatus === 'PROCESSING') {
        orderStatus = 'PAID'
        return { count: 1 }
      }
      return { count: 0 }
    },
  }

  ;(prisma as any).partnerClient = {
    update: async ({ data }: any) => {
      partnerBalance += Number(data?.balance?.increment ?? 0)
      return {}
    },
  }

  ;(prisma as any).partnerBalanceLedger = {
    findUnique: async () => (ledgerCreated ? { amount: settlementAmount, createdAt: new Date() } : null),
    create: async () => {
      if (ledgerCreated) {
        const err: any = new Error('duplicate')
        err.code = 'P2002'
        throw err
      }
      ledgerCreated = true
      return {}
    },
  }

  ;(prisma as any).$transaction = async (fn: any) =>
    fn({
      order: {
        findUnique: async () => ({
          id: 'o1',
          status: orderStatus,
          settlementTime,
          settlementAmount: ledgerCreated ? settlementAmount : null,
          pendingAmount: settlementAmount,
          amount: baseOrder.amount,
          feeLauncx,
          partnerClientId: baseOrder.partnerClientId,
          settlementStatus: null,
        }),
        update: async ({ data }: any) => {
          orderStatus = data.status
          settlementAmount = data.settlementAmount ?? settlementAmount
          feeLauncx = data.feeLauncx ?? feeLauncx
          settlementTime = data.settlementTime ?? settlementTime
          return {}
        },
      },
      partnerClient: (prisma as any).partnerClient,
      partnerBalanceLedger: (prisma as any).partnerBalanceLedger,
    })

  try {
    const first = await runManualSettlement({ context: { actor: 'tester', jobId: 'job-1' } })
    assert.equal(first.settledOrders, 1)
    assert.equal(first.netAmount, settlementAmount)
    assert.equal(partnerBalance, settlementAmount)
    assert.equal(orderStatus, 'SETTLED')

    // Simulate the order being re-queued while ledger entry already exists
    orderStatus = 'PAID'

    const second = await runManualSettlement({ context: { actor: 'tester', jobId: 'job-2' } })
    assert.equal(second.settledOrders, 0)
    assert.equal(second.netAmount, 0)
    assert.equal(partnerBalance, settlementAmount)
    assert.equal(orderStatus, 'SETTLED')
  } finally {
    ;(prisma as any).order = originalOrder
    ;(prisma as any).partnerClient = originalPartnerClient
    ;(prisma as any).partnerBalanceLedger = originalLedger
    ;(prisma as any).$transaction = originalTx
  }
})
