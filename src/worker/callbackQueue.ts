import { prisma } from '../core/prisma'
import { postWithRetry } from '../utils/postWithRetry'
import logger from '../logger'
import { config } from '../config'

export async function processCallbackJobs() {
  const jobs = await prisma.callbackJob.findMany({
    where: {
      delivered: false,
      attempts: { lt: config.api.callbackQueue.maxAttempts },
    },
    orderBy: { createdAt: 'asc' },
    take: config.api.callbackQueue.batchSize,
  })

  for (const job of jobs) {
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
        data: { delivered: true, attempts: job.attempts + 1, lastError: null },
      })
      logger.info(`[callbackQueue] delivered job ${job.id}`)
    } catch (err: any) {
      const attempts = job.attempts + 1
      const statusCode = err?.response?.status
      const isClientError = statusCode >= 400 && statusCode < 500
      const maxAttemptsReached =
        attempts >= config.api.callbackQueue.maxAttempts

      if (isClientError || maxAttemptsReached) {
        await prisma.callbackJobDeadLetter.create({
          data: {
            jobId: job.id,
            url: job.url,
            payload: job.payload,
            signature: job.signature,
            statusCode,
            errorMessage: err.message,
            attempts,
          },
        })
        await prisma.callbackJob.delete({ where: { id: job.id } })
        logger.error(
          `[callbackQueue] moved job ${job.id} to dead-letter queue: ${err.message}`
        )
      } else {
        await prisma.callbackJob.update({
          where: { id: job.id },
          data: { attempts, lastError: err.message },
        })
        logger.error(
          `[callbackQueue] delivery failed for job ${job.id}: ${err.message}`
        )
      }
    }
  }
}

export function startCallbackWorker() {
  setInterval(processCallbackJobs, config.api.callbackQueue.intervalMs)
  logger.info('Callback worker started')
}

if (require.main === module) {
  startCallbackWorker()
}