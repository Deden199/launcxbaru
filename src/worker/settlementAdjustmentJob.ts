import { v4 as uuidv4 } from 'uuid'
import {
  runSettlementAdjustmentJob,
  type SettlementAdjustmentJobParams,
  type SettlementAdjustmentSummary,
  type SettlementAdjustmentProgress,
} from '../service/settlementAdjustmentJob'

export type SettlementAdjustmentJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface SettlementAdjustmentWorkerPayload extends SettlementAdjustmentJobParams {
  adminId?: string
}

export interface SettlementAdjustmentWorkerJob {
  id: string
  status: SettlementAdjustmentJobStatus
  payload: SettlementAdjustmentWorkerPayload
  progress: SettlementAdjustmentProgress
  totals: {
    totalOrders: number
    totalTransactions: number
    updatedOrders: number
    updatedTransactions: number
  }
  range?: {
    start: string
    end: string
  }
  errors: string[]
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

const jobs = new Map<string, SettlementAdjustmentWorkerJob>()
const queue: SettlementAdjustmentWorkerJob[] = []
let current: SettlementAdjustmentWorkerJob | null = null

function nowIso() {
  return new Date().toISOString()
}

function handleProgress(job: SettlementAdjustmentWorkerJob, progress: SettlementAdjustmentProgress) {
  job.progress = progress
  job.updatedAt = nowIso()
}

function applySummary(job: SettlementAdjustmentWorkerJob, summary: SettlementAdjustmentSummary) {
  job.totals = {
    totalOrders: summary.totalOrders,
    totalTransactions: summary.totalTransactions,
    updatedOrders: summary.updatedOrderIds.length,
    updatedTransactions: summary.updatedTransactionIds.length,
  }
  job.range = {
    start: summary.startBoundary.toISOString(),
    end: summary.endBoundary.toISOString(),
  }
}

function runNext() {
  if (current || queue.length === 0) {
    return
  }

  const job = queue.shift()!
  current = job
  job.status = 'running'
  job.startedAt = nowIso()
  job.updatedAt = job.startedAt

  const { adminId: _adminId, ...payload } = job.payload

  runSettlementAdjustmentJob(payload, {
    onProgress: progress => handleProgress(job, progress),
  })
    .then(summary => {
      applySummary(job, summary)
      job.status = 'completed'
      job.completedAt = nowIso()
      job.updatedAt = job.completedAt
    })
    .catch(err => {
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      job.errors.push(job.error)
      job.updatedAt = nowIso()
    })
    .finally(() => {
      current = null
      runNext()
    })
}

export function startSettlementAdjustmentWorker(payload: SettlementAdjustmentWorkerPayload) {
  const created = nowIso()
  const job: SettlementAdjustmentWorkerJob = {
    id: uuidv4(),
    status: 'queued',
    payload: { ...payload },
    progress: { processed: 0, total: 0 },
    totals: { totalOrders: 0, totalTransactions: 0, updatedOrders: 0, updatedTransactions: 0 },
    errors: [],
    createdAt: created,
    updatedAt: created,
  }
  jobs.set(job.id, job)
  queue.push(job)
  runNext()
  return job
}

export function getSettlementAdjustmentJob(jobId: string) {
  return jobs.get(jobId)
}
