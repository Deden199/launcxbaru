// src/utils/password.ts
import * as bcrypt from 'bcrypt'

export async function hashPassword(pwd: string) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(pwd, salt)
}

export async function comparePassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash)
}
