import {
  runLoanSettlementByRange,
  type MarkSettledSummary,
} from '../service/loanSettlement'
import { prisma } from '../core/prisma'
import logger from '../logger'
import { wibTimestamp } from '../util/time'

export type LoanSettlementJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface LoanSettlementJobPayload {
  subMerchantId: string
  startDate: string
  endDate: string
  note?: string
  adminId?: string
  dryRun?: boolean
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

async function updateJobStatus(jobId: string, status: LoanSettlementJobStatus) {
  try {
    await prisma.loanSettlementJob.update({
      where: { id: jobId },
      data: { status },
    })
  } catch (error) {
    logger.error(`[LoanSettlementWorker] failed updating job ${jobId} status to ${status}`, error)
  }
}

function runNext() {
  while (activeJobs.size < LOAN_SETTLEMENT_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!
    activeJobs.add(job)
    job.status = 'running'
    job.startedAt = getNowIso()
    job.updatedAt = job.startedAt

    void prisma.loanSettlementJob
      .update({
        where: { id: job.id },
        data: { status: 'running', totalOrder: 0, totalLoanAmount: 0 },
      })
      .catch(error => {
        logger.error(`[LoanSettlementWorker] failed claiming job ${job.id}`, error)
      })

    runLoanSettlementByRange({
      ...job.payload,
      dryRun: job.payload.dryRun ?? false,
      loanSettlementJobId: job.id,
    })
      .then(summary => {
        job.summary = summary
        job.status = 'completed'
        job.completedAt = getNowIso()
        job.updatedAt = job.completedAt
        void updateJobStatus(job.id, 'completed')
        const hasFailures = summary.fail.length > 0 || summary.errors.length > 0
        if (hasFailures) {
          logger.warn(
            `[LoanSettlementWorker] job ${job.id} completed with ${summary.fail.length} failures (${summary.errors.length} errors)`,
          )
        } else {
          logger.info(
            `[LoanSettlementWorker] job ${job.id} completed successfully (${summary.ok.length} orders, dryRun=${job.payload.dryRun ?? false})`,
          )
        }
      })
      .catch(error => {
        job.status = 'failed'
        job.error = error instanceof Error ? error.message : String(error)
        job.updatedAt = getNowIso()
        void updateJobStatus(job.id, 'failed')
        logger.error(
          `[LoanSettlementWorker] job ${job.id} failed`,
          error instanceof Error ? error : new Error(String(error)),
        )
      })
      .finally(() => {
        activeJobs.delete(job)
        runNext()
      })
  }
}

export async function startLoanSettlementJob(payload: LoanSettlementJobPayload) {
  const dryRun = payload.dryRun ?? false

  const jobRecord = await prisma.loanSettlementJob.create({
    data: {
      subMerchantId: payload.subMerchantId,
      startDate: new Date(payload.startDate),
      endDate: new Date(payload.endDate),
      status: 'queued',
      dryRun,
      createdBy: payload.adminId,
    },
  })

  logger.info(
    `[LoanSettlementWorker] queued job ${jobRecord.id} (${payload.subMerchantId}) dryRun=${dryRun} range ${jobRecord.startDate.toISOString()} - ${jobRecord.endDate.toISOString()}`,
  )

  const job: LoanSettlementJob = {
    id: jobRecord.id,
    status: 'queued',
    payload: { ...payload, dryRun },
    summary: { ok: [], fail: [], errors: [] },
    createdAt: jobRecord.createdAt.toISOString(),
    updatedAt: jobRecord.updatedAt.toISOString(),
  }

  jobs.set(job.id, job)
  queue.push(job)
  runNext()
  return job.id
}

export function getLoanSettlementJob(jobId: string) {
  return jobs.get(jobId)
}
