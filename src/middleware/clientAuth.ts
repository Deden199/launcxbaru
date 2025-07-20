import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { prisma } from '../core/prisma'

export interface ClientAuthRequest extends Request {
  clientUserId?: string
  partnerClientId?: string
  isParent?: boolean
  childrenIds?: string[]
}

export async function requireClientAuth(
  req: ClientAuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.header('Authorization')
  if (!authHeader?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized' })

  const token = authHeader.slice(7)
  let payload: any
  try {
    payload = jwt.verify(token, config.api.jwtSecret) as Record<string, any>
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  if (typeof payload.sub !== 'string')
    return res.status(401).json({ error: 'Invalid token subject' })

  // 1) clientUserId
  req.clientUserId = payload.sub

  // 2) Cari PartnerClient dari ClientUser
  const cu = await prisma.clientUser.findUnique({
    where: { id: payload.sub },
    select: { partnerClientId: true }
  })
  if (!cu) return res.status(401).json({ error: 'ClientUser not found' })
  req.partnerClientId = cu.partnerClientId

    // 3) Pastikan partnerClient ada & cek apakah memiliki child
  const [pc, kids] = await Promise.all([
    prisma.partnerClient.findUnique({ where: { id: cu.partnerClientId }, select: { id: true } }),
    prisma.partnerClient.findMany({
      where: { parentClientId: cu.partnerClientId },
      select: { id: true }
    })
      ])
  if (!pc) return res.status(401).json({ error: 'PartnerClient not found' })

  // 4) Tandai parent hanya jika memang memiliki child
  req.isParent = kids.length > 0
  if (req.isParent) {
    req.childrenIds = kids.map(c => c.id)
  }

  next()
}
