import test from 'node:test'
import assert from 'node:assert/strict'

import { ORDER_STATUS } from '../src/types/orderStatus'

type MockOrder = {
  id: string
  subMerchantId: string
  status: string
  pendingAmount: number | null
  settlementAmount: number | null
  settlementStatus: string | null
  settlementTime: Date | null
  metadata: Record<string, unknown>
  loanedAt: Date | null
  createdAt: Date
  loanEntry?: {
    id?: string | null
    subMerchantId?: string | null
    amount: number | null
    metadata?: Record<string, unknown> | null
  } | null
}

const toNullableNumber = (value: any): number | null => {
  if (value === null || value === undefined) {
    return null
  }
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const cloneMetadataObject = (value: any) =>
  value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, any>) } : null

const getExpectedLoanEntrySnapshot = (order: Pick<MockOrder, 'loanEntry'>) =>
  order.loanEntry && typeof order.loanEntry === 'object'
    ? {
        id: typeof order.loanEntry.id === 'string' ? order.loanEntry.id : null,
        subMerchantId:
          typeof order.loanEntry.subMerchantId === 'string' ? order.loanEntry.subMerchantId : null,
        amount: toNullableNumber(order.loanEntry.amount),
        metadata: cloneMetadataObject(order.loanEntry.metadata),
      }
    : null

const expectSnapshotMatchesOrder = (snapshot: any, order: Partial<MockOrder>) => {
  assert.ok(snapshot)

  const status = typeof order.status === 'string' ? order.status : null
  const pendingAmount = toNullableNumber(order.pendingAmount)
  const settlementStatus = typeof order.settlementStatus === 'string' ? order.settlementStatus : null
  const settlementAmount = toNullableNumber(order.settlementAmount)
  const settlementTime = order.settlementTime instanceof Date ? order.settlementTime.toISOString() : null
  const loanedAt = order.loanedAt instanceof Date ? order.loanedAt.toISOString() : null
  const expectedLoanEntry = getExpectedLoanEntrySnapshot({ loanEntry: order.loanEntry ?? null })

  assert.equal(snapshot.status, status)
  assert.equal(snapshot.previousStatus, status)
  assert.equal(snapshot.pendingAmount, pendingAmount)
  assert.equal(snapshot.previousPendingAmount, pendingAmount)
  assert.equal(snapshot.settlementStatus, settlementStatus)
  assert.equal(snapshot.previousSettlementStatus, settlementStatus)
  assert.equal(snapshot.settlementAmount, settlementAmount)
  assert.equal(snapshot.previousSettlementAmount, settlementAmount)
  assert.equal(snapshot.settlementTime, settlementTime)
  assert.equal(snapshot.previousSettlementTime, settlementTime)
  assert.equal(snapshot.loanedAt ?? null, loanedAt)
  assert.deepEqual(snapshot.loanEntry ?? null, expectedLoanEntry)
  assert.deepEqual(snapshot.previousLoanEntry ?? null, expectedLoanEntry)
}

const expectPreviousLoanEntryMetadata = (actual: any, expected: ReturnType<typeof getExpectedLoanEntrySnapshot>) => {
  if (!expected) {
    assert.equal(actual ?? null, null)
    return
  }

  assert.ok(actual)
  assert.equal(actual.id ?? null, expected.id ?? null)
  assert.equal(actual.subMerchantId ?? null, expected.subMerchantId ?? null)
  assert.equal(actual.amount ?? null, expected.amount ?? null)
  assert.deepEqual(actual.metadata ?? null, expected.metadata ?? null)

  if (expected.amount != null) {
    assert.equal(actual.originalAmount ?? null, expected.amount)
  } else {
    assert.equal(actual.originalAmount ?? null, null)
  }

  const expectedMetadata = expected.metadata ?? {}
  if (expectedMetadata && typeof expectedMetadata === 'object') {
    if (Object.prototype.hasOwnProperty.call(expectedMetadata, 'markedAt')) {
      assert.equal(actual.markedAt ?? null, expectedMetadata.markedAt ?? null)
    } else {
      assert.equal(actual.markedAt ?? null, null)
    }

    if (Object.prototype.hasOwnProperty.call(expectedMetadata, 'reason')) {
      assert.equal(actual.reason ?? null, expectedMetadata.reason ?? null)
    } else {
      assert.equal(actual.reason ?? null, null)
    }

    if (Object.prototype.hasOwnProperty.call(expectedMetadata, 'markedBy')) {
      assert.equal(actual.markedBy ?? null, expectedMetadata.markedBy ?? null)
    } else {
      assert.equal(actual.markedBy ?? null, null)
    }
  }
}

const sortOrders = (orders: MockOrder[]) =>
  orders.slice().sort((a, b) => {
    const diff = a.createdAt.getTime() - b.createdAt.getTime()
    if (diff !== 0) {
      return diff
    }
    return a.id.localeCompare(b.id)
  })

const evaluateCursorCondition = (order: MockOrder, condition: any) => {
  if (Object.prototype.hasOwnProperty.call(condition, 'createdAt')) {
    const createdAtCondition = condition.createdAt

    if (createdAtCondition instanceof Date) {
      if (order.createdAt.getTime() !== createdAtCondition.getTime()) {
        return false
      }
    } else if (createdAtCondition && typeof createdAtCondition === 'object') {
      const { gt, gte, lt, lte } = createdAtCondition
      if (gt instanceof Date && !(order.createdAt.getTime() > gt.getTime())) {
        return false
      }
      if (gte instanceof Date && !(order.createdAt.getTime() >= gte.getTime())) {
        return false
      }
      if (lt instanceof Date && !(order.createdAt.getTime() < lt.getTime())) {
        return false
      }
      if (lte instanceof Date && !(order.createdAt.getTime() <= lte.getTime())) {
        return false
      }
    } else {
      return false
    }
  }

  if (Object.prototype.hasOwnProperty.call(condition, 'id')) {
    const idCondition = condition.id
    if (idCondition && typeof idCondition === 'object') {
      if (Object.prototype.hasOwnProperty.call(idCondition, 'gt') && !(order.id > idCondition.gt)) {
        return false
      }
      if (Object.prototype.hasOwnProperty.call(idCondition, 'gte') && !(order.id >= idCondition.gte)) {
        return false
      }
      if (Object.prototype.hasOwnProperty.call(idCondition, 'lt') && !(order.id < idCondition.lt)) {
        return false
      }
      if (Object.prototype.hasOwnProperty.call(idCondition, 'lte') && !(order.id <= idCondition.lte)) {
        return false
      }
    } else if (typeof idCondition === 'string') {
      if (order.id !== idCondition) {
        return false
      }
    }
  }

  return true
}

const loadLoanSettlementService = () => {
  const prismaPath = require.resolve('../src/core/prisma')
  const adminLogPath = require.resolve('../src/util/adminLog')
  const originalPrismaModule = require.cache[prismaPath]
  const originalAdminLogModule = require.cache[adminLogPath]

  const prismaMock = {
    order: {},
    loanEntry: {},
    $transaction: async () => undefined,
  } as any

  const adminLogMock = {
    logAdminAction: async () => undefined,
  }

  require.cache[prismaPath] = {
    id: prismaPath,
    filename: prismaPath,
    loaded: true,
    exports: { prisma: prismaMock },
  } as any

  require.cache[adminLogPath] = {
    id: adminLogPath,
    filename: adminLogPath,
    loaded: true,
    exports: adminLogMock,
  } as any

  const servicePath = require.resolve('../src/service/loanSettlement')
  delete require.cache[servicePath]

  const service = require(servicePath) as typeof import('../src/service/loanSettlement')

  const restoreModules = () => {
    delete require.cache[servicePath]
    if (originalPrismaModule) {
      require.cache[prismaPath] = originalPrismaModule
    } else {
      delete require.cache[prismaPath]
    }

    if (originalAdminLogModule) {
      require.cache[adminLogPath] = originalAdminLogModule
    } else {
      delete require.cache[adminLogPath]
    }
  }

  return { service, prismaMock, restoreModules }
}

const mockPrismaOrders = (prismaMock: any, orders: MockOrder[]) => {
  const clonedOrders = orders.map(order => ({
    ...order,
    metadata: { ...order.metadata },
    loanEntry: order.loanEntry
      ? {
          id: order.loanEntry.id ?? null,
          subMerchantId: order.loanEntry.subMerchantId ?? null,
          amount: order.loanEntry.amount,
          metadata: order.loanEntry.metadata
            ? { ...(order.loanEntry.metadata as Record<string, unknown>) }
            : null,
        }
      : null,
  }))

  prismaMock.__orders = clonedOrders
  prismaMock.__loanEntries = [] as any[]
  prismaMock.__loanDeletes = [] as any[]
  prismaMock.__updates = [] as any[]

  prismaMock.order.findMany = async (args: any) => {
    assert.ok(args)
    assert.equal(args.skip, undefined)
    const { where, take } = args

    const filtered = sortOrders(clonedOrders).filter(order => {
      if (where?.subMerchantId && order.subMerchantId !== where.subMerchantId) {
        return false
      }

      if (where?.status) {
        if (typeof where.status === 'string') {
          if (order.status !== where.status) {
            return false
          }
        } else if (where.status && typeof where.status === 'object' && Array.isArray(where.status.in)) {
          if (!where.status.in.includes(order.status)) {
            return false
          }
        }
      }

      if (where?.createdAt?.gte && order.createdAt < where.createdAt.gte) {
        return false
      }

      if (where?.createdAt?.lte && order.createdAt > where.createdAt.lte) {
        return false
      }

      if (Array.isArray(where?.OR)) {
        return where.OR.some((condition: any) => evaluateCursorCondition(order, condition))
      }

      return true
    })

    return filtered.slice(0, take ?? filtered.length).map(order => ({
      id: order.id,
      status: order.status,
      pendingAmount: order.pendingAmount,
      settlementAmount: order.settlementAmount,
      settlementStatus: order.settlementStatus,
      settlementTime: order.settlementTime,
      metadata: { ...order.metadata },
      subMerchantId: order.subMerchantId,
      loanedAt: order.loanedAt,
      createdAt: order.createdAt,
      loanEntry: order.loanEntry
        ? {
            id: order.loanEntry.id ?? null,
            subMerchantId: order.loanEntry.subMerchantId ?? null,
            amount: order.loanEntry.amount,
            metadata: order.loanEntry.metadata
              ? { ...(order.loanEntry.metadata as Record<string, unknown>) }
              : null,
          }
        : null,
    }))
  }

  const updateMany = async ({ where, data }: any) => {
    const record = clonedOrders.find(order => order.id === where.id)
    if (!record || record.status !== where.status) {
      return { count: 0 }
    }

    prismaMock.__updates.push({ where: { ...where }, data })

    if (Object.prototype.hasOwnProperty.call(data, 'status')) {
      record.status = data.status
    }

    if (Object.prototype.hasOwnProperty.call(data, 'pendingAmount')) {
      record.pendingAmount = data.pendingAmount
    }

    if (Object.prototype.hasOwnProperty.call(data, 'loanedAt')) {
      record.loanedAt = data.loanedAt
    }

    if (Object.prototype.hasOwnProperty.call(data, 'settlementStatus')) {
      record.settlementStatus = data.settlementStatus
    }

    if (Object.prototype.hasOwnProperty.call(data, 'settlementAmount')) {
      record.settlementAmount = data.settlementAmount
    }

    if (Object.prototype.hasOwnProperty.call(data, 'settlementTime')) {
      record.settlementTime = data.settlementTime
    }

    if (Object.prototype.hasOwnProperty.call(data, 'metadata')) {
      record.metadata = { ...(data.metadata ?? {}) }
    }

    return { count: 1 }
  }

  const upsert = async ({ where, create, update }: any) => {
    const record = clonedOrders.find(order => order.id === where.orderId)
    if (!record) {
      return update
    }
    if (record.loanedAt) {
      prismaMock.__loanEntries.push({ ...update, orderId: where.orderId })
      return update
    }
    prismaMock.__loanEntries.push({ ...create, orderId: where.orderId })
    return create
  }

  const deleteMany = async ({ where }: any) => {
    prismaMock.__loanDeletes.push({ where })
    prismaMock.__loanEntries = prismaMock.__loanEntries.filter(
      (entry: any) => entry.orderId !== where.orderId,
    )
    return { count: 1 }
  }

  prismaMock.$transaction = async (callback: any) =>
    callback({
      order: { updateMany },
      loanEntry: { upsert, deleteMany },
    })
}

const setupLoanSettlement = (orders: MockOrder[]) => {
  const { service, prismaMock, restoreModules } = loadLoanSettlementService()
  mockPrismaOrders(prismaMock, orders)

  return {
    runLoanSettlementByRange: service.runLoanSettlementByRange,
    revertLoanSettlementsByRange: service.revertLoanSettlementsByRange,
    prismaMock,
    restore: restoreModules,
  }
}

const getExpectedOrderIds = (orders: MockOrder[], batchSize: number) => {
  const sorted = sortOrders(orders)
  const expected: string[] = []
  let page = 0

  while (true) {
    const start = page * batchSize
    const chunk = sorted.slice(start, start + batchSize)
    if (chunk.length === 0) {
      break
    }
    expected.push(...chunk.map(order => order.id))
    page += 1
  }

  return expected
}

test('runLoanSettlementByRange returns empty summary when no orders match the query', async t => {
  const { runLoanSettlementByRange, restore } = setupLoanSettlement([])
  process.env.LOAN_FETCH_BATCH_SIZE = '2'

  t.after(() => {
    restore()
    delete process.env.LOAN_FETCH_BATCH_SIZE
  })

  const summary = await runLoanSettlementByRange({
    subMerchantId: 'sub-1',
    startDate: '2024-01-01',
    endDate: '2024-01-01',
  })

  assert.deepEqual(summary.ok, [])
  assert.deepEqual(summary.fail, [])
  assert.deepEqual(summary.errors, [])
})

test('cursor pagination returns the same order sequence as the previous offset implementation', async t => {
  const batchSize = 2
  const baseCreatedAt = new Date('2024-01-01T00:00:00.000Z')

  const orders: MockOrder[] = [
    {
      id: 'order-1',
      subMerchantId: 'sub-1',
      status: ORDER_STATUS.PAID,
      pendingAmount: 100,
      settlementAmount: null,
      settlementStatus: null,
      settlementTime: null,
      metadata: {},
      loanedAt: null,
      createdAt: new Date(baseCreatedAt.getTime()),
    },
    {
      id: 'order-2',
      subMerchantId: 'sub-1',
      status: ORDER_STATUS.PAID,
      pendingAmount: 200,
      settlementAmount: null,
      settlementStatus: null,
      settlementTime: null,
      metadata: {},
      loanedAt: null,
      createdAt: new Date(baseCreatedAt.getTime() + 60_000),
    },
    {
      id: 'order-3',
      subMerchantId: 'sub-1',
      status: ORDER_STATUS.PAID,
      pendingAmount: 300,
      settlementAmount: null,
      settlementStatus: null,
      settlementTime: null,
      metadata: {},
      loanedAt: null,
      createdAt: new Date(baseCreatedAt.getTime() + 120_000),
    },
    {
      id: 'order-4',
      subMerchantId: 'sub-1',
      status: ORDER_STATUS.PAID,
      pendingAmount: 400,
      settlementAmount: null,
      settlementStatus: null,
      settlementTime: null,
      metadata: {},
      loanedAt: null,
      createdAt: new Date(baseCreatedAt.getTime() + 180_000),
    },
  ]

  const { runLoanSettlementByRange, restore } = setupLoanSettlement(orders)
  process.env.LOAN_FETCH_BATCH_SIZE = String(batchSize)

  t.after(() => {
    restore()
    delete process.env.LOAN_FETCH_BATCH_SIZE
  })

  const summary = await runLoanSettlementByRange({
    subMerchantId: 'sub-1',
    startDate: '2024-01-01',
    endDate: '2024-01-01',
  })

  const expected = getExpectedOrderIds(orders, batchSize)

  assert.deepEqual(summary.ok, expected)
  assert.deepEqual(summary.fail, [])
  assert.deepEqual(summary.errors, [])
})

test('cursor pagination handles duplicate createdAt values deterministically', async t => {
  const batchSize = 3
  const createdAt = new Date('2024-01-01T00:00:00.000Z')

  const orders: MockOrder[] = [
    {
      id: 'order-1',
      subMerchantId: 'sub-1',
      status: ORDER_STATUS.PAID,
      pendingAmount: 100,
      settlementAmount: null,
      settlementStatus: null,
      metadata: {},
      loanedAt: null,
      createdAt,
      settlementTime: null,
    },
    {
      id: 'order-2',
      subMerchantId: 'sub-1',
      status: ORDER_STATUS.PAID,
      pendingAmount: 200,
      settlementAmount: null,
      settlementStatus: null,
      metadata: {},
      loanedAt: null,
      createdAt,
      settlementTime: null,
    },
    {
      id: 'order-3',
      subMerchantId: 'sub-1',
      status: ORDER_STATUS.PAID,
      pendingAmount: 300,
      settlementAmount: null,
      settlementStatus: null,
      metadata: {},
      loanedAt: null,
      createdAt,
      settlementTime: null,
    },
    {
      id: 'order-4',
      subMerchantId: 'sub-1',
      status: ORDER_STATUS.PAID,
      pendingAmount: 400,
      settlementAmount: null,
      settlementStatus: null,
      metadata: {},
      loanedAt: null,
      createdAt,
      settlementTime: null,
    },
  ]

  const { runLoanSettlementByRange, restore } = setupLoanSettlement(orders)
  process.env.LOAN_FETCH_BATCH_SIZE = String(batchSize)

  t.after(() => {
    restore()
    delete process.env.LOAN_FETCH_BATCH_SIZE
  })

  const summary = await runLoanSettlementByRange({
    subMerchantId: 'sub-1',
    startDate: '2024-01-01',
    endDate: '2024-01-01',
  })

  const expected = getExpectedOrderIds(orders, batchSize)
  const sortedIds = [...summary.ok].sort((a, b) => a.localeCompare(b))

  assert.deepEqual(summary.ok, expected)
  assert.deepEqual(summary.ok, sortedIds)
  assert.deepEqual(summary.fail, [])
  assert.deepEqual(summary.errors, [])
})

test('revertLoanSettlementsByRange restores orders based on snapshot history', async t => {
  const loanedAt = new Date('2024-05-02T10:00:00.000Z')
  const snapshotSettlementTime = '2024-04-30T08:00:00.000Z'

  const historyEntry = {
    reason: 'loan_adjustment',
    previousStatus: ORDER_STATUS.SUCCESS,
    markedAt: '2024-05-02T10:00:00.000Z',
    markedBy: 'admin-old',
    snapshot: {
      status: ORDER_STATUS.SUCCESS,
      pendingAmount: 450,
      settlementStatus: 'PAID',
      settlementAmount: 450,
      settlementTime: snapshotSettlementTime,
      loanedAt: null,
      loanEntry: {
        id: 'loan-prev-restore',
        subMerchantId: 'sub-restore',
        amount: 320,
        metadata: { reason: 'previous-loan', markedAt: '2024-04-28T12:00:00.000Z' },
      },
      previousStatus: ORDER_STATUS.SUCCESS,
      previousPendingAmount: 450,
      previousSettlementStatus: 'PAID',
      previousSettlementAmount: 450,
      previousSettlementTime: snapshotSettlementTime,
      previousLoanEntry: {
        id: 'loan-prev-restore',
        subMerchantId: 'sub-restore',
        amount: 320,
        metadata: { reason: 'previous-loan', markedAt: '2024-04-28T12:00:00.000Z' },
      },
    },
  }

  const orders: MockOrder[] = [
    {
      id: 'order-restore-1',
      subMerchantId: 'sub-restore',
      status: ORDER_STATUS.LN_SETTLED,
      pendingAmount: null,
      settlementAmount: null,
      settlementStatus: null,
      settlementTime: loanedAt,
      metadata: {
        loanSettlementHistory: [historyEntry],
        lastLoanSettlement: historyEntry,
      },
      loanedAt,
      createdAt: new Date('2024-04-01T00:00:00.000Z'),
      loanEntry: {
        id: 'loan-current-restore',
        subMerchantId: 'sub-restore',
        amount: 600,
        metadata: { reason: 'loan_adjustment' },
      },
    },
  ]

  const { revertLoanSettlementsByRange, prismaMock, restore } = setupLoanSettlement(orders)

  process.env.LOAN_FETCH_BATCH_SIZE = '2'

  t.after(() => {
    restore()
    delete process.env.LOAN_FETCH_BATCH_SIZE
  })

  const summary = await revertLoanSettlementsByRange({
    subMerchantId: 'sub-restore',
    startDate: '2024-05-01',
    endDate: '2024-05-03',
    adminId: 'admin-new',
    note: 'Undo settlement',
  })

  assert.deepEqual(summary.ok, ['order-restore-1'])
  assert.deepEqual(summary.fail, [])
  assert.equal(summary.errors.length, 0)
  assert.equal(summary.events.length, 1)
  assert.equal(summary.events[0]?.restoredStatus, ORDER_STATUS.SUCCESS)
  assert.ok(summary.exportFile)
  assert.match(summary.exportFile!.fileName, /^loan-revert-sub-restore-/)

  assert.equal(prismaMock.__updates.length, 1)
  const update = prismaMock.__updates[0]
  assert.equal(update.where.id, 'order-restore-1')
  assert.equal(update.where.status, ORDER_STATUS.LN_SETTLED)
  assert.equal(update.data.status, ORDER_STATUS.SUCCESS)
  assert.equal(update.data.pendingAmount, 450)
  assert.equal(update.data.settlementStatus, 'PAID')
  assert.equal(update.data.settlementAmount, 450)
  assert.equal(update.data.settlementTime.toISOString(), snapshotSettlementTime)
  const restoredSnapshot = update.data.metadata.loanSettlementHistory[0].snapshot
  expectSnapshotMatchesOrder(restoredSnapshot, {
    status: ORDER_STATUS.SUCCESS,
    pendingAmount: 450,
    settlementAmount: 450,
    settlementStatus: 'PAID',
    settlementTime: new Date(snapshotSettlementTime),
    loanEntry: {
      id: 'loan-prev-restore',
      subMerchantId: 'sub-restore',
      amount: 320,
      metadata: { reason: 'previous-loan', markedAt: '2024-04-28T12:00:00.000Z' },
    },
  })
  assert.ok(update.data.metadata.lastLoanSettlementRevert)
  assert.equal(prismaMock.__loanDeletes.length, 0)
  assert.equal(prismaMock.__loanEntries.length, 1)
  const loanUpsert = prismaMock.__loanEntries[0]
  assert.equal(loanUpsert.orderId, 'order-restore-1')
  assert.equal(loanUpsert.subMerchantId, 'sub-restore')
  assert.equal(loanUpsert.amount, 320)
  assert.deepEqual(loanUpsert.metadata, {
    reason: 'previous-loan',
    markedAt: '2024-04-28T12:00:00.000Z',
  })
})

test('revertLoanSettlementsByRange supports exportOnly flag', async t => {
  const loanedAt = new Date('2024-05-10T00:00:00.000Z')
  const historyEntry = {
    reason: 'loan_adjustment',
    previousStatus: ORDER_STATUS.SUCCESS,
    markedAt: '2024-05-10T00:00:00.000Z',
    markedBy: 'admin-old',
    snapshot: {
      status: ORDER_STATUS.SUCCESS,
      pendingAmount: 0,
      settlementStatus: 'PAID',
      settlementAmount: 100,
      settlementTime: '2024-05-09T23:00:00.000Z',
      loanedAt: null,
      loanEntry: {
        id: 'loan-prev-export',
        subMerchantId: 'sub-export',
        amount: 80,
        metadata: { reason: 'previous-loan', markedAt: '2024-05-09T10:00:00.000Z' },
      },
      previousStatus: ORDER_STATUS.SUCCESS,
      previousPendingAmount: 0,
      previousSettlementStatus: 'PAID',
      previousSettlementAmount: 100,
      previousSettlementTime: '2024-05-09T23:00:00.000Z',
      previousLoanEntry: {
        id: 'loan-prev-export',
        subMerchantId: 'sub-export',
        amount: 80,
        metadata: { reason: 'previous-loan', markedAt: '2024-05-09T10:00:00.000Z' },
      },
    },
  }

  const orders: MockOrder[] = [
    {
      id: 'order-export-1',
      subMerchantId: 'sub-export',
      status: ORDER_STATUS.LN_SETTLED,
      pendingAmount: null,
      settlementAmount: null,
      settlementStatus: null,
      settlementTime: loanedAt,
      metadata: {
        loanSettlementHistory: [historyEntry],
        lastLoanSettlement: historyEntry,
      },
      loanedAt,
      createdAt: new Date('2024-05-01T00:00:00.000Z'),
      loanEntry: null,
    },
  ]

  const { revertLoanSettlementsByRange, prismaMock, restore } = setupLoanSettlement(orders)

  t.after(() => {
    restore()
  })

  const summary = await revertLoanSettlementsByRange({
    subMerchantId: 'sub-export',
    startDate: '2024-05-01',
    endDate: '2024-05-12',
    exportOnly: true,
  })

  assert.deepEqual(summary.ok, ['order-export-1'])
  assert.deepEqual(summary.fail, [])
  assert.equal(summary.errors.length, 0)
  assert.equal(summary.events.length, 0)
  assert.ok(summary.exportFile)
  assert.equal(prismaMock.__updates.length, 0)
})

test('runLoanSettlementByRange updates eligible statuses and creates loan entries using pending or settlement amounts', async t => {
  const baseCreatedAt = new Date('2024-02-01T00:00:00.000Z')
  const orders: MockOrder[] = [
    {
      id: 'order-paid',
      subMerchantId: 'sub-loan',
      status: ORDER_STATUS.PAID,
      pendingAmount: 150,
      settlementAmount: null,
      settlementStatus: 'READY',
      settlementTime: new Date('2024-02-01T05:00:00.000Z'),
      metadata: {},
      loanedAt: null,
      createdAt: baseCreatedAt,
    },
    {
      id: 'order-success',
      subMerchantId: 'sub-loan',
      status: ORDER_STATUS.SUCCESS,
      pendingAmount: null,
      settlementAmount: 250,
      settlementStatus: 'READY',
      settlementTime: new Date('2024-02-01T06:00:00.000Z'),
      metadata: {},
      loanedAt: null,
      createdAt: new Date(baseCreatedAt.getTime() + 60_000),
      loanEntry: {
        id: 'loan-prev-success',
        subMerchantId: 'sub-loan',
        amount: 200,
        metadata: { reason: 'previous-loan', markedAt: '2024-01-31T18:00:00.000Z' },
      },
    },
    {
      id: 'order-done',
      subMerchantId: 'sub-loan',
      status: ORDER_STATUS.DONE,
      pendingAmount: null,
      settlementAmount: 0,
      settlementStatus: 'READY',
      settlementTime: new Date('2024-02-01T07:00:00.000Z'),
      metadata: {},
      loanedAt: null,
      createdAt: new Date(baseCreatedAt.getTime() + 120_000),
    },
    {
      id: 'order-settled',
      subMerchantId: 'sub-loan',
      status: ORDER_STATUS.SETTLED,
      pendingAmount: null,
      settlementAmount: 500,
      settlementStatus: 'READY',
      settlementTime: new Date('2024-02-01T08:00:00.000Z'),
      metadata: {},
      loanedAt: null,
      createdAt: new Date(baseCreatedAt.getTime() + 180_000),
      loanEntry: {
        id: 'loan-prev-settled',
        subMerchantId: 'sub-loan',
        amount: 450,
        metadata: { reason: 'previous-loan', markedAt: '2024-01-31T19:00:00.000Z' },
      },
    },
  ]

  const { runLoanSettlementByRange, prismaMock, restore } = (() => {
    const { service, prismaMock, restoreModules } = loadLoanSettlementService()
    mockPrismaOrders(prismaMock, orders)
    return { runLoanSettlementByRange: service.runLoanSettlementByRange, prismaMock, restore: restoreModules }
  })()

  process.env.LOAN_FETCH_BATCH_SIZE = '10'

  t.after(() => {
    restore()
    delete process.env.LOAN_FETCH_BATCH_SIZE
  })

  const summary = await runLoanSettlementByRange({
    subMerchantId: 'sub-loan',
    startDate: '2024-02-01',
    endDate: '2024-02-02',
    note: 'Range loan adjust',
    adminId: 'admin-loan',
  })

  assert.deepEqual(summary.fail, [])
  assert.equal(summary.errors.length, 0)
  assert.deepEqual(summary.ok.sort(), orders.map(order => order.id).sort())

  const updatedOrders = prismaMock.__orders.filter((order: MockOrder) => order.status === ORDER_STATUS.LN_SETTLED)
  assert.equal(updatedOrders.length, orders.length)
  for (const order of updatedOrders) {
    const original = orders.find(o => o.id === order.id)!
    assert.equal(order.pendingAmount, null)
    assert.equal(order.settlementStatus, null)
    assert.equal(order.settlementAmount, null)
    assert.equal(order.settlementTime, null)
    assert.ok(order.loanedAt instanceof Date)
    assert.ok(order.metadata.lastLoanSettlement)
    assert.equal(order.metadata.lastLoanSettlement.note, 'Range loan adjust')
    assert.equal(order.metadata.lastLoanSettlement.markedBy, 'admin-loan')
    assert.equal(order.metadata.lastLoanSettlement.previousStatus, original.status)
    expectSnapshotMatchesOrder(order.metadata.lastLoanSettlement.snapshot, {
      ...original,
      loanEntry: original.loanEntry ?? null,
    })
    const expectedLoanEntry = getExpectedLoanEntrySnapshot(original)
    assert.deepEqual(
      order.metadata.lastLoanSettlement.snapshot.previousLoanEntry ?? null,
      expectedLoanEntry,
    )
  }

  const loanEntries = prismaMock.__loanEntries
  const loanEntrySummary = loanEntries
    .filter((entry: any) => entry.amount > 0)
    .map((entry: any) => ({ orderId: entry.orderId, amount: entry.amount }))
    .sort((a: any, b: any) => a.orderId.localeCompare(b.orderId))

  assert.deepEqual(loanEntrySummary, [
    { orderId: 'order-paid', amount: 150 },
    { orderId: 'order-settled', amount: 500 },
    { orderId: 'order-success', amount: 250 },
  ])

  for (const entry of loanEntries) {
    const original = orders.find(order => order.id === entry.orderId)
    const expectedLoanEntry = original ? getExpectedLoanEntrySnapshot(original) : null
    expectPreviousLoanEntryMetadata(entry.metadata.previousLoanEntry ?? null, expectedLoanEntry)
  }
})

