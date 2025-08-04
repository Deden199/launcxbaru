import { Response } from 'express'
import { authenticator } from 'otplib'
import { prisma } from '../../core/prisma'
import { AuthRequest } from '../../middleware/auth'

const ISSUER = 'Launcx'

export async function setupAdminTOTP(req: AuthRequest, res: Response) {
  const userId = req.userId!
  const user = await prisma.partnerUser.findUnique({ where: { id: userId } })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })

  const secret = authenticator.generateSecret()
  const otpauthUrl = authenticator.keyuri(user.email, ISSUER, secret)

  await prisma.partnerUser.update({
    where: { id: userId },
    data: { totpSecret: secret, totpEnabled: false }
  })

  return res.json({ otpauthUrl })
}

export async function enableAdminTOTP(req: AuthRequest, res: Response) {
  const { code } = req.body as { code?: string }
  const userId = req.userId!
  const user = await prisma.partnerUser.findUnique({
    where: { id: userId },
    select: { totpSecret: true }
  })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
  if (!user.totpSecret) return res.status(400).json({ error: 'Belum melakukan setup' })
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Kode OTP harus 6 digit' })
  }
  if (!authenticator.verify({ token: code, secret: user.totpSecret })) {
    return res.status(400).json({ error: 'Kode OTP salah' })
  }
  await prisma.partnerUser.update({
    where: { id: userId },
    data: { totpEnabled: true }
  })
  return res.json({ success: true })
}

export async function getAdminTOTPStatus(req: AuthRequest, res: Response) {
  const user = await prisma.partnerUser.findUnique({
    where: { id: req.userId! },
    select: { totpEnabled: true }
  })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
  return res.json({ totpEnabled: user.totpEnabled })
}