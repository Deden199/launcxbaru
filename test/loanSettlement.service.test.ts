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
  metadata: Record<string, unknown>
  loanedAt: Date | null
  createdAt: Date
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
  }))

  prismaMock.order.findMany = async (args: any) => {
    assert.ok(args)
    assert.equal(args.skip, undefined)
    const { where, take } = args

    const filtered = sortOrders(clonedOrders).filter(order => {
      if (where?.subMerchantId && order.subMerchantId !== where.subMerchantId) {
        return false
      }

      if (where?.status && order.status !== where.status) {
        return false
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
      metadata: { ...order.metadata },
      subMerchantId: order.subMerchantId,
      loanedAt: order.loanedAt,
      createdAt: order.createdAt,
    }))
  }

  const updateMany = async ({ where, data }: any) => {
    const record = clonedOrders.find(order => order.id === where.id)
    if (!record || record.status !== where.status) {
      return { count: 0 }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'status')) {
      record.status = data.status
    }

    if (Object.prototype.hasOwnProperty.call(data, 'pendingAmount')) {
      record.pendingAmount = data.pendingAmount
    }

    if (Object.prototype.hasOwnProperty.call(data, 'loanedAt')) {
      record.loanedAt = data.loanedAt
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
      return update
    }
    return create
  }

  prismaMock.$transaction = async (callback: any) =>
    callback({
      order: { updateMany },
      loanEntry: { upsert },
    })
}

const setupLoanSettlement = (orders: MockOrder[]) => {
  const { service, prismaMock, restoreModules } = loadLoanSettlementService()
  mockPrismaOrders(prismaMock, orders)

  return {
    runLoanSettlementByRange: service.runLoanSettlementByRange,
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

