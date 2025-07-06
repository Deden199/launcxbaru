import { prisma } from '../core/prisma'
import crypto from 'crypto'

export async function createClient(name: string) {
  const apiKey = crypto.randomBytes(16).toString('hex')
  const apiSecret = crypto.randomBytes(32).toString('hex')
  return prisma.partnerClient.create({
    data: { name, apiKey, apiSecret }
  })
}
