import { v4 as uuidv4 } from 'uuid'
import { runManualSettlement, resetSettlementState, restartSettlementChecker } from '../cron/settlement'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface SettlementJob {
  id: string
  status: JobStatus
  settledOrders: number
  netAmount: number
  error?: string
  actor?: string
}

const jobs = new Map<string, SettlementJob>()
const queue: SettlementJob[] = []
let current: SettlementJob | null = null

function runNext() {
  if (current || queue.length === 0) return
  const job = queue.shift()!
  current = job
  job.status = 'running'
  resetSettlementState()
  runManualSettlement({
    onProgress: p => {
      job.settledOrders = p.settledOrders
      job.netAmount = p.netAmount
    },
    context: { actor: job.actor, jobId: job.id, trigger: 'worker' },
  })
    .then(() => {
      job.status = 'completed'
    })
    .catch(err => {
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
    })
    .finally(() => {
      restartSettlementChecker('')
      current = null
      runNext()
    })
}

export interface StartSettlementJobOptions {
  actor?: string
}

export function startSettlementJob(options: StartSettlementJobOptions = {}) {
  const job: SettlementJob = {
    id: uuidv4(),
    status: 'queued',
    settledOrders: 0,
    netAmount: 0,
    actor: options.actor,
  }
  jobs.set(job.id, job)
  queue.push(job)
  runNext()
  return job.id
}

export function getSettlementJob(jobId: string) {
  return jobs.get(jobId)
}
