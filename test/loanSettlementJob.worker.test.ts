import test from 'node:test'
import assert from 'node:assert/strict'

test('loan settlement worker processes jobs concurrently up to configured limit', async () => {
  process.env.JWT_SECRET = 'test'
  process.env.LOAN_SETTLEMENT_CONCURRENCY = '2'

  const servicePath = require.resolve('../src/service/loanSettlement')
  const originalService = require.cache[servicePath]
  const timePath = require.resolve('../src/util/time')
  const originalTime = require.cache[timePath]
  const prismaPath = require.resolve('../src/core/prisma')
  const originalPrisma = require.cache[prismaPath]

  let activeCount = 0
  const concurrencySamples: number[] = []
  const resolvers: Array<() => void> = []

  const runLoanSettlementByRange = () => {
    activeCount += 1
    concurrencySamples.push(activeCount)

    return new Promise(resolve => {
      resolvers.push(() => {
        activeCount -= 1
        resolve({ ok: [], fail: [], errors: [] })
      })
    })
  }

  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      runLoanSettlementByRange,
    },
  } as any

  let jobCounter = 0
  const prismaMock = {
    loanSettlementJob: {
      create: async ({ data }: any) => {
        jobCounter += 1
        return {
          id: `job-${jobCounter}`,
          subMerchantId: data.subMerchantId,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          status: data.status,
          dryRun: data.dryRun ?? false,
          totalOrder: 0,
          totalLoanAmount: 0,
          createdBy: data.createdBy ?? null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        }
      },
      update: async () => ({}),
    },
  }

  require.cache[prismaPath] = {
    id: prismaPath,
    filename: prismaPath,
    loaded: true,
    exports: { prisma: prismaMock },
  } as any

  require.cache[timePath] = {
    id: timePath,
    filename: timePath,
    loaded: true,
    exports: {
      wibTimestamp: () => new Date('2024-01-01T00:00:00.000Z'),
    },
  } as any

  const workerPath = require.resolve('../src/worker/loanSettlementJob')
  delete require.cache[workerPath]

  const { startLoanSettlementJob, getLoanSettlementJob } = require(workerPath)

  const payload = {
    subMerchantId: 'sub-1',
    startDate: '2024-01-01',
    endDate: '2024-01-02',
  }

  const jobIds = [
    await startLoanSettlementJob(payload),
    await startLoanSettlementJob({ ...payload, subMerchantId: 'sub-2' }),
    await startLoanSettlementJob({ ...payload, subMerchantId: 'sub-3' }),
  ]

  await new Promise(resolve => setImmediate(resolve))

  const firstJob = getLoanSettlementJob(jobIds[0])
  const secondJob = getLoanSettlementJob(jobIds[1])
  const thirdJob = getLoanSettlementJob(jobIds[2])

  assert.equal(firstJob?.status, 'running')
  assert.equal(secondJob?.status, 'running')
  assert.equal(thirdJob?.status, 'queued')
  assert.ok(firstJob?.startedAt)
  assert.ok(secondJob?.startedAt)
  assert.ok(!thirdJob?.startedAt)
  assert.equal(concurrencySamples.every(sample => sample <= 2), true)
  assert.equal(Math.max(...concurrencySamples), 2)

  resolvers.shift()?.()
  await new Promise(resolve => setImmediate(resolve))

  const updatedThirdJob = getLoanSettlementJob(jobIds[2])
  assert.equal(updatedThirdJob?.status, 'running')
  assert.ok(updatedThirdJob?.startedAt)

  while (resolvers.length) {
    resolvers.shift()?.()
  }

  await new Promise(resolve => setImmediate(resolve))

  for (const jobId of jobIds) {
    const job = getLoanSettlementJob(jobId)
    assert.equal(job?.status, 'completed')
    assert.ok(job?.completedAt)
    assert.equal(job?.summary.ok.length, 0)
    assert.equal(job?.summary.fail.length, 0)
    assert.equal(job?.summary.errors.length, 0)
  }

  delete require.cache[workerPath]
  if (originalService) {
    require.cache[servicePath] = originalService
  } else {
    delete require.cache[servicePath]
  }

  if (originalTime) {
    require.cache[timePath] = originalTime
  } else {
    delete require.cache[timePath]
  }

  if (originalPrisma) {
    require.cache[prismaPath] = originalPrisma
  } else {
    delete require.cache[prismaPath]
  }

  delete process.env.LOAN_SETTLEMENT_CONCURRENCY
  delete process.env.JWT_SECRET
})
