// src/controllers/clientAuth.controller.ts
import { Request, Response } from 'express'
import { prisma } from '../core/prisma'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { config } from '../config'

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
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password wajib diisi' })
  }

  const user = await prisma.clientUser.findUnique({ where: { email } })
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const token = jwt.sign(
    { sub: user.id, role: user.role },
    config.api.jwtSecret,      // ← PASTIKAN pakai config.api.jwtSecret
    { expiresIn: '1h' }
  )
  res.json({ token })
}
