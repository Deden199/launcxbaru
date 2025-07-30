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
      await postWithRetry(job.url, job.payload, {
        headers: { 'X-Callback-Signature': job.signature },
        timeout: 5000,
      })
      await prisma.callbackJob.update({
        where: { id: job.id },
        data: { delivered: true, attempts: job.attempts + 1, lastError: null },
      })
      logger.info(`[callbackQueue] delivered job ${job.id}`)
    } catch (err: any) {
      await prisma.callbackJob.update({
        where: { id: job.id },
        data: { attempts: job.attempts + 1, lastError: err.message },
      })
      logger.error(`[callbackQueue] delivery failed for job ${job.id}: ${err.message}`)
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