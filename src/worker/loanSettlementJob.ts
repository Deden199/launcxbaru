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

const DEFAULT_LOAN_SETTLEMENT_CONCURRENCY = 2
const configuredConcurrency = Number(process.env.LOAN_SETTLEMENT_CONCURRENCY)
const LOAN_SETTLEMENT_CONCURRENCY =
  Number.isFinite(configuredConcurrency) && configuredConcurrency >= 1
    ? Math.max(1, Math.floor(configuredConcurrency))
    : DEFAULT_LOAN_SETTLEMENT_CONCURRENCY

const jobs = new Map<string, LoanSettlementJob>()
const queue: LoanSettlementJob[] = []
const activeJobs = new Set<LoanSettlementJob>()

const getNowIso = () => wibTimestamp().toISOString()

function runNext() {
  while (activeJobs.size < LOAN_SETTLEMENT_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!
    activeJobs.add(job)
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
        activeJobs.delete(job)
        runNext()
      })
  }
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
