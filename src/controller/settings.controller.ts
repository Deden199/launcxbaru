import { Request, Response } from 'express'
import { prisma } from '../core/prisma'
import { setWeekendOverrideDates } from '../util/time'
import { AuthRequest } from '../middleware/auth'
import { logAdminAction } from '../util/adminLog'

export async function getSettings(req: Request, res: Response) {
  const rows = await prisma.setting.findMany()
  const obj: Record<string,string> = {}
  rows.forEach(r => { obj[r.key] = r.value })
  res.json({ data: obj })
}

export async function updateSettings(req: AuthRequest, res: Response) {
  const updates: Record<string,string> = req.body
  const tx = await prisma.$transaction(
    Object.entries(updates).map(([key,value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value }
      })
    )
  )
    if (updates['weekend_override_dates'] !== undefined) {
    const dates = updates['weekend_override_dates']
      .split(',')
      .map(d => d.trim())
      .filter(Boolean)
    setWeekendOverrideDates(dates)
  }
  if (req.userId) {
    await logAdminAction(req.userId, 'updateSettings', 'settings', updates)
  }
  res.json({ data: tx })
}
