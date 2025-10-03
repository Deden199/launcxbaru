import test from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'

const PRISMA_NULL_TYPES = (Prisma as unknown as {
  NullTypes?: { JsonNull?: unknown; DbNull?: unknown }
}).NullTypes

const PRISMA_JSON_NULL =
  (Prisma as unknown as { JsonNull?: unknown }).JsonNull ?? PRISMA_NULL_TYPES?.JsonNull
const PRISMA_DB_NULL =
  (Prisma as unknown as { DbNull?: unknown }).DbNull ?? PRISMA_NULL_TYPES?.DbNull

const prismaPath = require.resolve('../src/core/prisma')

const prismaMock: any = {
  order: {
    findMany: async () => [],
    update: async () => ({}),
  },
  loanEntry: {
    update: async () => ({}),
  },
  $disconnect: async () => {},
}

require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: prismaMock,
  },
} as any

const { cleanupReversalMetadata } = require('../scripts/cleanupReversalMetadata')

test('cleanupReversalMetadata removes reversal metadata without touching other fields', async () => {
  let capturedWhere: any = null
  let capturedOrderUpdate: any = null
  let capturedLoanEntryUpdate: any = null

  const originalMetadata = {
    reversal: { reason: 'test' },
    previousStatus: 'SETTLED',
    previousSettlementTime: '2024-05-01T00:00:00.000Z',
    previousSettlementAmount: 500,
    reason: 'manual',
    reversedAt: '2024-05-02T00:00:00.000Z',
    reversedBy: 'admin',
    keep: 'value',
    nested: { foo: 'bar' },
  }

  const originalLoanEntryMetadata = {
    reversal: { reason: 'loan' },
    lastAction: 'REVERSED',
    keep: true,
    extra: { nested: 'value' },
  }

  const orderResult = {
    id: 'order-123',
    metadata: { ...originalMetadata },
    loanEntry: {
      id: 'loan-entry-1',
      metadata: { ...originalLoanEntryMetadata },
    },
  }

  prismaMock.order.findMany = async (args: any) => {
    capturedWhere = args?.where
    return [orderResult]
  }

  prismaMock.order.update = async (args: any) => {
    capturedOrderUpdate = args
    return {}
  }

  prismaMock.loanEntry.update = async (args: any) => {
    capturedLoanEntryUpdate = args
    return {}
  }

  const summary = await cleanupReversalMetadata({
    startDate: '2024-05-01',
    endDate: '2024-05-03',
    dryRun: false,
  })

  assert.equal(summary.total, 1)
  assert.equal(summary.success, 1)
  assert.deepEqual(summary.failed, [])
  assert.equal(summary.dryRun, false)

  assert.ok(capturedWhere)
  assert.ok(Array.isArray(capturedWhere?.NOT))
  assert.ok(
    capturedWhere?.NOT?.some(
      (clause: any) => clause?.metadata === null,
    ),
  )
  assert.ok(
    capturedWhere?.NOT?.some(
      (clause: any) =>
        clause?.metadata?.path?.[0] === 'reversal' && clause?.metadata?.equals === null,
    ),
  )

  if (PRISMA_JSON_NULL !== undefined) {
    assert.ok(
      capturedWhere?.NOT?.some(
        (clause: any) => clause?.metadata === PRISMA_JSON_NULL,
      ),
    )
  }

  if (PRISMA_DB_NULL !== undefined) {
    assert.ok(
      capturedWhere?.NOT?.some(
        (clause: any) => clause?.metadata === PRISMA_DB_NULL,
      ),
    )
  }

  assert.ok(capturedOrderUpdate)
  assert.equal(capturedOrderUpdate.where.id, 'order-123')
  assert.equal(capturedOrderUpdate.data.loanedAt, null)
  assert.deepEqual(capturedOrderUpdate.data.metadata, {
    keep: 'value',
    nested: { foo: 'bar' },
  })

  assert.ok(capturedLoanEntryUpdate)
  assert.deepEqual(capturedLoanEntryUpdate, {
    where: { id: 'loan-entry-1' },
    data: { metadata: { keep: true, extra: { nested: 'value' } } },
  })

  assert.deepEqual(orderResult.metadata, originalMetadata)
  assert.deepEqual(orderResult.loanEntry?.metadata, originalLoanEntryMetadata)
})

test('cleanupReversalMetadata sanitizes primitive reversal metadata values', async () => {
  let capturedWhere: any = null
  let capturedOrderUpdate: any = null

  const primitiveMetadata = {
    reversal: true,
    keep: 42,
    nested: { foo: 'bar' },
  }

  prismaMock.order.findMany = async (args: any) => {
    capturedWhere = args?.where
    return [
      {
        id: 'order-primitive',
        metadata: { ...primitiveMetadata },
        loanedAt: new Date('2024-05-02T00:00:00.000Z'),
        loanEntry: null,
      },
    ]
  }

  prismaMock.order.update = async (args: any) => {
    capturedOrderUpdate = args
    return {}
  }

  const summary = await cleanupReversalMetadata({
    startDate: '2024-05-01',
    endDate: '2024-05-03',
    dryRun: false,
  })

  assert.equal(summary.total, 1)
  assert.equal(summary.success, 1)
  assert.deepEqual(summary.failed, [])
  assert.equal(summary.dryRun, false)

  assert.ok(Array.isArray(capturedWhere?.NOT))
  assert.ok(
    capturedWhere?.NOT?.some(
      (clause: any) =>
        clause?.metadata?.path?.[0] === 'reversal' && clause?.metadata?.equals === null,
    ),
  )
  assert.equal(
    capturedWhere?.NOT?.some(
      (clause: any) =>
        clause?.metadata?.path?.[0] === 'reversal' && clause?.metadata?.equals === true,
    ),
    false,
  )

  assert.ok(capturedOrderUpdate)
  assert.equal(capturedOrderUpdate.where.id, 'order-primitive')
  assert.equal(capturedOrderUpdate.data.loanedAt, null)
  assert.deepEqual(capturedOrderUpdate.data.metadata, {
    keep: 42,
    nested: { foo: 'bar' },
  })

  prismaMock.order.findMany = async () => []
  prismaMock.order.update = async () => ({})
})
