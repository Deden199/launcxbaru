import test from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = 'test'
const { buildSummaryMessage } = require('../src/cron/dashboardSummary')
const { prisma } = require('../src/core/prisma')

const zeroAgg = (args: any) => {
  const key = Object.keys(args._sum)[0]
  return { _sum: { [key]: 0 } }
}

test('buildSummaryMessage includes group summaries', async () => {
  ;(prisma as any).partnerClient = {
    findMany: async () => [
      { id: 'p1', name: 'Parent1', children: [{ id: 'c1', name: 'Child1' }] },
      { id: 'p2', name: 'Parent2', children: [] }
    ]
  }
  ;(prisma as any).order = { aggregate: async (args: any) => zeroAgg(args) }
  ;(prisma as any).withdrawRequest = { aggregate: async (args: any) => zeroAgg(args) }

  const blocks = await buildSummaryMessage()
  assert.equal(blocks.length, 2)
  assert.match(blocks[1], /\[Dashboard Summary - Parent1\]/)
  assert.match(blocks[1], /Total Payment Volume/)
})
