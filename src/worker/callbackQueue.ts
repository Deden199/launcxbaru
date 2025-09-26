import { prisma } from '../core/prisma'
import { postWithRetry } from '../utils/postWithRetry'
import logger from '../logger'
import { config } from '../config'

async function handleCallbackJob(job: Awaited<ReturnType<typeof prisma.callbackJob.findFirst>>) {
  if (!job) return

  try {
    await postWithRetry(
      job.url,
      job.payload,
      {
        headers: { 'X-Callback-Signature': job.signature },
        timeout: 5000,
      },
      3
    )
    await prisma.callbackJob.update({
      where: { id: job.id },
      data: {
        delivered: true,
        attempts: job.attempts + 1,
        lastError: null,
        responseBody: null,
      },
    })
    logger.info(`[callbackQueue] delivered job ${job.id}`)
  } catch (err: any) {
    const attempts = job.attempts + 1
    const statusCode = err?.response?.status
    const isRateLimited = statusCode === 429
    const isClientError =
      statusCode >= 400 && statusCode < 500 && !isRateLimited
    const maxAttemptsReached =
      attempts >= config.api.callbackQueue.maxAttempts

    if (isClientError || maxAttemptsReached) {
      await prisma.callbackJobDeadLetter.create({
        data: {
          jobId: job.id,
          partnerClientId: job.partnerClientId,
          url: job.url,
          payload: job.payload,
          signature: job.signature,
          statusCode,
          errorMessage: err.message,
          responseBody: err.response?.data ?? null,
          attempts,
        },
      })
      await prisma.callbackJob.delete({ where: { id: job.id } })
      logger.error(
        `[callbackQueue] moved job ${job.id} to dead-letter queue: ${err.message}`
      )
    } else {
      const lastError = {
        statusCode: statusCode ?? null,
        message: err?.message ?? 'Unknown error',
        timestamp: new Date().toISOString(),
      }

      await prisma.callbackJob.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError,
          responseBody: err.response?.data ?? null,
        },
      })
      logger.error(
        `[callbackQueue] delivery failed for job ${job.id}: ${err.message}`
      )
    }
  }
}

export async function processCallbackJobs() {
  const jobs = await prisma.callbackJob.findMany({
    where: {
      delivered: false,
      // Guard against legacy rows that were created without a partnerClientId.
      // If these appear in the database, delete them or backfill the missing
      // partnerClientId manually to keep the queue healthy.
      partnerClientId: { not: null },
      attempts: { lt: config.api.callbackQueue.maxAttempts },
    },
    orderBy: { createdAt: 'asc' },
    take: config.api.callbackQueue.batchSize,
  })

  const concurrency = Math.max(1, config.api.callbackQueue.concurrency)
  const executing: Promise<void>[] = []

  for (const job of jobs) {
    const task = handleCallbackJob(job).finally(() => {
      const index = executing.indexOf(task)
      if (index !== -1) {
        executing.splice(index, 1)
      }
    })
    executing.push(task)
    if (executing.length >= concurrency) {
      await Promise.race(executing)
    }
  }

  if (executing.length > 0) {
    await Promise.allSettled(executing)
  }
}

export function startCallbackWorker() {
  setInterval(processCallbackJobs, config.api.callbackQueue.intervalMs)
  logger.info('Callback worker started')
}

if (require.main === module) {
  startCallbackWorker()
}