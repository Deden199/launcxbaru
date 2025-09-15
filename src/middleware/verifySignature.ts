import { Response, NextFunction } from 'express'
import crypto from 'crypto'
import { prisma } from '../core/prisma'
import { ApiKeyRequest } from './apiKeyAuth'

export async function verifySignature(
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
) {
  const clientId = req.clientId
  const ts = req.header('X-Timestamp') || ''
  const gotSig = req.header('X-Signature') || ''
  if (!clientId || !ts || !gotSig) {
    return res.status(401).json({ error: 'Missing signature headers' })
  }
  const client = await prisma.partnerClient.findUnique({
    where: { id: clientId },
    select: { apiSecret: true },
  })
  if (!client) {
    return res.status(401).json({ error: 'Client not found' })
  }
  const rawBody = (req as any).rawBody || ''
  const path = req.originalUrl.split('?')[0]
  const payload = `${req.method}:${path}:${ts}:${rawBody}`
  const expected = crypto
    .createHmac('sha256', client.apiSecret)
    .update(payload)
    .digest('hex')
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(gotSig))) {
    return res.status(401).json({ error: 'Invalid signature' })
  }
  next()
}
