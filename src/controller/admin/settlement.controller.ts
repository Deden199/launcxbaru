import { Response } from 'express'
import { runManualSettlement } from '../../cron/settlement'
import { AuthRequest } from '../../middleware/auth'
import { logAdminAction } from '../../util/adminLog'

export async function manualSettlement(req: AuthRequest, res: Response) {
  const result = await runManualSettlement()
  if (req.userId) {
    await logAdminAction(req.userId, 'manualSettlement', null, result)
  }
  res.json({ data: result })
}

