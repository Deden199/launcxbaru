import { prisma } from '../core/prisma'
import jwt from 'jsonwebtoken'
import { hashPassword, comparePassword } from '../util/password'

const JWT_SECRET = process.env.JWT_SECRET!
const JWT_EXPIRES_IN = '7d'

export async function authenticate(email: string, password: string) {
  const user = await prisma.partnerUser.findUnique({ where: { email } })
  if (!user || !user.isActive) throw new Error('Invalid credentials')
  const match = await comparePassword(password, user.password)
  if (!match) throw new Error('Invalid credentials')
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
  return { token, user }
}

export async function getCurrentUser(userId: string) {
    return prisma.partnerUser.findUnique({ where: { id: userId } })
  }
