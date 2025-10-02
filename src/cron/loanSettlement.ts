import cron, { ScheduledTask } from 'node-cron'

import { prisma } from '../core/prisma'
import logger from '../logger'
import { runLoanSettlementByRange } from '../service/loanSettlement'
import { tryAdvisoryLock, releaseAdvisoryLock } from '../util/dbLock'

const DEFAULT_CRON_SCHEDULE = '*/2 * * * *'
const DEFAULT_MAX_JOBS_PER_TICK = 5
const LOAN_CRON_LOCK_KEY = 9_876_543_210

const configuredSchedule = process.env.LOAN_SETTLEMENT_CRON_SCHEDULE
const configuredMaxJobs = Number(process.env.LOAN_SETTLEMENT_MAX_JOBS_PER_TICK)

const LOAN_CRON_SCHEDULE = configuredSchedule && configuredSchedule.trim().length > 0
  ? configuredSchedule
  : DEFAULT_CRON_SCHEDULE

const MAX_JOBS_PER_TICK = Number.isFinite(configuredMaxJobs) && configuredMaxJobs > 0
  ? Math.floor(configuredMaxJobs)
  : DEFAULT_MAX_JOBS_PER_TICK

let task: ScheduledTask | null = null
let processing = false

async function processPendingLoanSettlementJobs() {
  if (processing) {
    logger.debug('[LoanSettlementCron] previous tick still running, skipping')
    return
  }

  processing = true
  const lockAcquired = await tryAdvisoryLock(LOAN_CRON_LOCK_KEY)
  if (!lockAcquired) {
    logger.debug('[LoanSettlementCron] unable to acquire advisory lock, skipping tick')
    processing = false
    return
  }

  try {
    const jobs = await prisma.loanSettlementJob.findMany({
      where: { status: { in: ['pending', 'queued'] } },
      orderBy: { createdAt: 'asc' },
      take: MAX_JOBS_PER_TICK,
    })

    if (jobs.length === 0) {
      logger.debug('[LoanSettlementCron] no pending jobs found')
      return
    }

    for (const job of jobs) {
      const claimed = await prisma.loanSettlementJob.updateMany({
        where: { id: job.id, status: { in: ['pending', 'queued'] } },
        data: { status: 'running', totalOrder: 0, totalLoanAmount: 0 },
      })

      if (claimed.count === 0) {
        logger.debug(`[LoanSettlementCron] job ${job.id} already claimed by another worker`)
        continue
      }

      logger.info(
        `[LoanSettlementCron] processing job ${job.id} (${job.subMerchantId}) range ${job.startDate.toISOString()} - ${job.endDate.toISOString()}`,
      )

      try {
        const summary = await runLoanSettlementByRange({
          subMerchantId: job.subMerchantId,
          startDate: job.startDate.toISOString(),
          endDate: job.endDate.toISOString(),
          note: `Automated loan settlement job ${job.id}`,
          adminId: job.createdBy ?? undefined,
          loanSettlementJobId: job.id,
        })

        const hasErrors = summary.fail.length > 0 || summary.errors.length > 0

        await prisma.loanSettlementJob.update({
          where: { id: job.id },
          data: { status: 'completed' },
        })

        if (hasErrors) {
          logger.warn(
            `[LoanSettlementCron] job ${job.id} completed with ${summary.fail.length} failures: ${summary.errors
              .map(err => `${err.orderId}:${err.message}`)
              .join(', ')}`,
          )
        } else {
          logger.info(
            `[LoanSettlementCron] job ${job.id} completed successfully with ${summary.ok.length} orders`,
          )
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`[LoanSettlementCron] job ${job.id} failed: ${message}`)

        await prisma.loanSettlementJob.update({
          where: { id: job.id },
          data: { status: 'failed' },
        })
      }
    }
  } catch (err) {
    logger.error('[LoanSettlementCron] unexpected error', err)
  } finally {
    await releaseAdvisoryLock(LOAN_CRON_LOCK_KEY)
    processing = false
  }
}

export function scheduleLoanSettlementCron(): ScheduledTask {
  if (task) {
    return task
  }

  task = cron.schedule(LOAN_CRON_SCHEDULE, () => {
    void processPendingLoanSettlementJobs()
  })

  task.start()
  logger.info(`[LoanSettlementCron] scheduled with pattern ${LOAN_CRON_SCHEDULE}`)
  return task
}

export async function runLoanSettlementCronOnce() {
  await processPendingLoanSettlementJobs()
}
