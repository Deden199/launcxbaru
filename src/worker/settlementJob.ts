import { v4 as uuidv4 } from 'uuid'
import {
  runManualSettlement,
  resetSettlementState,
  restartSettlementChecker,
  type ManualSettlementRunOptions,
} from '../cron/settlement'
import type { ManualSettlementFilters, ManualSettlementPreview } from '../types/manualSettlement'
import { logAdminAction } from '../util/adminLog'
import { createCsvExport } from '../util/export'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SettlementJob {
  id: string
  status: JobStatus
  settledOrders: number
  netAmount: number
  error?: string
  filters: ManualSettlementFilters
  createdBy?: string
  createdAt: Date
  updatedAt: Date
  batches: number
  cancelRequested?: boolean
  cancelled?: boolean
  preview?: ManualSettlementPreview
}

const jobs = new Map<string, SettlementJob>()
const queue: SettlementJob[] = []
let current: SettlementJob | null = null

export type StartSettlementJobOptions = {
  filters: ManualSettlementFilters
  createdBy?: string
  preview?: ManualSettlementPreview
}

async function logJobOutcome(job: SettlementJob, outcome: JobStatus) {
  if (!job.createdBy) {
    return
  }

  const detail: Record<string, any> = {
    jobId: job.id,
    status: outcome,
    settledOrders: job.settledOrders,
    netAmount: job.netAmount,
    batches: job.batches,
    filters: job.filters,
    preview: job.preview ?? null,
    cancelled: job.cancelled ?? false,
    error: job.error ?? null,
  }

  if (outcome === 'completed') {
    detail.exportFile = createCsvExport({
      headers: ['Metric', 'Value'],
      rows: [
        ['Job ID', job.id],
        ['Status', 'COMPLETED'],
        ['Settled Orders', job.settledOrders],
        ['Net Amount', job.netAmount],
        ['Batches', job.batches],
      ],
      fileNamePrefix: `manual-settlement-${job.id}`,
    })
  }

  const actionMap: Record<JobStatus, string> = {
    queued: 'manualSettlementJobQueued',
    running: 'manualSettlementJobRunning',
    completed: 'manualSettlementJobCompleted',
    failed: 'manualSettlementJobFailed',
    cancelled: 'manualSettlementJobCancelled',
  }

  try {
    await logAdminAction(job.createdBy, actionMap[outcome], job.id, detail)
  } catch (err) {
    console.error('[SettlementJob] Failed to log admin action', err)
  }
}

function runNext() {
  if (current || queue.length === 0) return
  const job = queue.shift()!
  current = job
  job.status = 'running'
  job.updatedAt = new Date()
  resetSettlementState()
  void logJobOutcome(job, 'running')

  const options: ManualSettlementRunOptions = {
    filters: job.filters,
    shouldCancel: () => job.cancelRequested === true,
    onProgress: progress => {
      job.settledOrders = progress.settledOrders
      job.netAmount = progress.netAmount
      job.batches = progress.batchesProcessed
      job.updatedAt = new Date()
    },
  }

  runManualSettlement(options)
    .then(async result => {
      job.settledOrders = result.settledOrders
      job.netAmount = result.netAmount
      job.batches = result.batches
      job.cancelled = result.cancelled || job.cancelRequested
      job.status = job.cancelled ? 'cancelled' : 'completed'
      job.updatedAt = new Date()
      if (job.cancelled && !job.error) {
        job.error = 'Cancelled'
      }
      await logJobOutcome(job, job.status)
    })
    .catch(async err => {
      job.error = err instanceof Error ? err.message : String(err)
      job.status = job.cancelRequested ? 'cancelled' : 'failed'
      job.cancelled = job.status === 'cancelled'
      job.updatedAt = new Date()
      await logJobOutcome(job, job.status)
    })
    .finally(() => {
      restartSettlementChecker('')
      current = null
      runNext()
    })
}

export function startSettlementJob(options: StartSettlementJobOptions) {
  const now = new Date()
  const job: SettlementJob = {
    id: uuidv4(),
    status: 'queued',
    settledOrders: 0,
    netAmount: 0,
    filters: options.filters,
    createdBy: options.createdBy,
    createdAt: now,
    updatedAt: now,
    batches: 0,
    preview: options.preview,
  }
  jobs.set(job.id, job)
  queue.push(job)
  void logJobOutcome(job, 'queued')
  runNext()
  return job.id
}

export function getSettlementJob(jobId: string) {
  return jobs.get(jobId)
}

export function cancelSettlementJob(jobId: string) {
  const job = jobs.get(jobId)
  if (!job) {
    return false
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return false
  }

  if (job.status === 'queued') {
    const idx = queue.findIndex(j => j.id === jobId)
    if (idx >= 0) {
      queue.splice(idx, 1)
    }
    job.status = 'cancelled'
    job.cancelRequested = true
    job.cancelled = true
    job.updatedAt = new Date()
    void logJobOutcome(job, 'cancelled')
    return true
  }

  if (job.status === 'running') {
    job.cancelRequested = true
    job.updatedAt = new Date()
    return true
  }

  return false
}
