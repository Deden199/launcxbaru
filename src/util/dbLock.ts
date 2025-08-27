import logger from '../logger'
import { prisma } from '../core/prisma'

export async function tryAdvisoryLock(key: number): Promise<boolean> {
  try {
    const res = await (prisma as any).$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${key}) AS locked`
    return res?.[0]?.locked ?? false
  } catch (err) {
    logger.error('[dbLock] failed to acquire lock', err)
    return false
  }
}

export async function releaseAdvisoryLock(key: number): Promise<void> {
  try {
    await (prisma as any).$queryRaw`SELECT pg_advisory_unlock(${key})`
  } catch (err) {
    logger.error('[dbLock] failed to release lock', err)
  }
}
