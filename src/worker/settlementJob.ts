import { v4 as uuidv4 } from 'uuid'
import { runManualSettlement } from '../cron/settlement'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface SettlementJob {
  id: string
  status: JobStatus
  settledOrders: number
  netAmount: number
  error?: string
}

const jobs = new Map<string, SettlementJob>()
const queue: SettlementJob[] = []
let current: SettlementJob | null = null

function runNext() {
  if (current || queue.length === 0) return
  const job = queue.shift()!
  current = job
  job.status = 'running'
  runManualSettlement(p => {
    job.settledOrders = p.settledOrders
    job.netAmount = p.netAmount
  })
    .then(() => {
      job.status = 'completed'
    })
    .catch(err => {
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
    })
    .finally(() => {
      current = null
      runNext()
    })
}

export function startSettlementJob() {
  const job: SettlementJob = {
    id: uuidv4(),
    status: 'queued',
    settledOrders: 0,
    netAmount: 0,
  }
  jobs.set(job.id, job)
  queue.push(job)
  runNext()
  return job.id
}

export function getSettlementJob(jobId: string) {
  return jobs.get(jobId)
}
