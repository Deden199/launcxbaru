import { v4 as uuidv4 } from 'uuid'

import {
  runLoanSettlementByRange,
  type MarkSettledSummary,
} from '../service/loanSettlement'
import { wibTimestamp } from '../util/time'

export type LoanSettlementJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface LoanSettlementJobPayload {
  subMerchantId: string
  startDate: string
  endDate: string
  note?: string
  adminId?: string
}

export interface LoanSettlementJob {
  id: string
  status: LoanSettlementJobStatus
  payload: LoanSettlementJobPayload
  summary: MarkSettledSummary
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

const jobs = new Map<string, LoanSettlementJob>()
const queue: LoanSettlementJob[] = []
let current: LoanSettlementJob | null = null

const getNowIso = () => wibTimestamp().toISOString()

function runNext() {
  if (current || queue.length === 0) return

  const job = queue.shift()!
  current = job
  job.status = 'running'
  job.startedAt = getNowIso()
  job.updatedAt = job.startedAt

  runLoanSettlementByRange(job.payload)
    .then(summary => {
      job.summary = summary
      job.status = 'completed'
      job.completedAt = getNowIso()
      job.updatedAt = job.completedAt
    })
    .catch(error => {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      job.updatedAt = getNowIso()
    })
    .finally(() => {
      current = null
      runNext()
    })
}

export function startLoanSettlementJob(payload: LoanSettlementJobPayload) {
  const nowIso = getNowIso()
  const job: LoanSettlementJob = {
    id: uuidv4(),
    status: 'queued',
    payload: { ...payload },
    summary: { ok: [], fail: [], errors: [] },
    createdAt: nowIso,
    updatedAt: nowIso,
  }

  jobs.set(job.id, job)
  queue.push(job)
  runNext()
  return job.id
}

export function getLoanSettlementJob(jobId: string) {
  return jobs.get(jobId)
}
