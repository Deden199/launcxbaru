import { Response } from 'express'
import { authenticator } from 'otplib'
import { prisma } from '../core/prisma'
import { ClientAuthRequest } from '../middleware/clientAuth'

const ISSUER = 'Launcx'

export async function setupTOTP(req: ClientAuthRequest, res: Response) {
  const userId = req.clientUserId!
  const user = await prisma.clientUser.findUnique({ where: { id: userId } })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })

  const secret = authenticator.generateSecret()
  const otpauthUrl = authenticator.keyuri(user.email, ISSUER, secret)

  await prisma.clientUser.update({
    where: { id: userId },
    data: { totpSecret: secret, totpEnabled: false }
  })

  return res.json({ otpauthUrl })
}

export async function enableTOTP(req: ClientAuthRequest, res: Response) {
  const { code } = req.body as { code?: string }
  const userId = req.clientUserId!
  const user = await prisma.clientUser.findUnique({
    where: { id: userId },
    select: { totpSecret: true }
  })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
  if (!user.totpSecret) return res.status(400).json({ error: 'Belum melakukan setup' })
  if (!code || !authenticator.check(code, user.totpSecret)) {
    return res.status(400).json({ error: 'Kode OTP salah' })
  }
  await prisma.clientUser.update({
    where: { id: userId },
    data: { totpEnabled: true }
  })
  return res.json({ success: true })

  }

export async function getTOTPStatus(req: ClientAuthRequest, res: Response) {
  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    select: { totpEnabled: true }
  })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
  return res.json({ totpEnabled: user.totpEnabled })
}