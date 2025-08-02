// src/controllers/clientAuth.controller.ts
import { Request, Response } from 'express'
import { prisma } from '../core/prisma'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { ClientAuthRequest } from '../middleware/clientAuth'
import { authenticator } from 'otplib'


export async function clientRegister(req: Request, res: Response) {
  const { partnerClientId, email, password } = req.body
  if (!partnerClientId || !email || !password) {
    return res.status(400).json({ error: 'partnerClientId, email, dan password wajib diisi' })
  }
  const hash = await bcrypt.hash(password, 10)
  const user = await prisma.clientUser.create({
    data: {
      partnerClientId,
      email,
      password: hash,
      role: 'PARTNER_CLIENT',    // ← pastikan diisi
      isActive: true,
    }
  })
  res.status(201).json({ id: user.id, email: user.email })
}

export async function clientLogin(req: Request, res: Response) {
  const { email, password, otp } = req.body as {
    email?: string
    password?: string
    otp?: string
  }
    if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password wajib diisi' })
  }

  const user = await prisma.clientUser.findUnique({ where: { email } })
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  if (user.totpEnabled) {
    if (!otp) return res.status(400).json({ error: 'OTP wajib diisi' })
    if (!user.totpSecret || !authenticator.check(String(otp), user.totpSecret)) {
      return res.status(401).json({ error: 'OTP tidak valid' })
    }
  }

  const token = jwt.sign(
    { sub: user.id, role: user.role },
    config.api.jwtSecret,      // ← PASTIKAN pakai config.api.jwtSecret
    { expiresIn: '12h' }
  )
  res.json({ token })
}
export async function changeClientPassword(
  req: ClientAuthRequest,
  res: Response
) {
  const { oldPassword, newPassword } = req.body as {
    oldPassword?: string
    newPassword?: string
  }

  if (!oldPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: 'oldPassword dan newPassword wajib diisi' })
  }

  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
  })
  if (!user) {
    return res.status(404).json({ error: 'User tidak ditemukan' })
  }

  const ok = await bcrypt.compare(oldPassword, user.password)
  if (!ok) {
    return res.status(401).json({ error: 'Password lama salah' })
  }

  const hash = await bcrypt.hash(newPassword, 10)
  await prisma.clientUser.update({
    where: { id: user.id },
    data: { password: hash },
  })

  return res.json({ message: 'Password berhasil diubah' })
}