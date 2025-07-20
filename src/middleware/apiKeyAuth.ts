import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { prisma } from '../core/prisma'

export interface ApiKeyRequest extends Request {
  clientId?: string
  isParent?: boolean
  childrenIds?: string[]
}

export default async function apiKeyAuth(
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
) {
  const gotKey = req.header('X-API-Key')
  const ts     = req.header('X-Timestamp')
  if (!gotKey || !ts)
    return res.status(401).json({ error: 'Missing API key or timestamp' })

  const timestamp = parseInt(ts, 10)
  const SKEW = 5 * 60 * 1000
  if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > SKEW)
    return res.status(400).json({ error: 'Invalid or expired timestamp' })

  // 1) Cari partnerClient + parentClientId
  const client = await prisma.partnerClient.findUnique({
    where: { apiKey: gotKey },
    select: { id: true, apiKey: true, isActive: true, parentClientId: true }
  })
  if (!client || !client.isActive)
    return res.status(401).json({ error: 'Invalid or inactive API key' })

  // 2) Compare timing-safe
  if (!crypto.timingSafeEqual(Buffer.from(client.apiKey), Buffer.from(gotKey)))
    return res.status(401).json({ error: 'Invalid API key' })

  // 3) Attach context
  req.clientId = client.id
  const kids = await prisma.partnerClient.findMany({
    where: { parentClientId: client.id },
    select: { id: true }
  })
  req.isParent = kids.length > 0

  // 4) Jika parent, load childrenIds
  if (req.isParent) {
    req.childrenIds = kids.map(c => c.id)
  }

  next()
}
