import { Response } from 'express'
import { runManualSettlement } from '../../cron/settlement'
import { AuthRequest } from '../../middleware/auth'
import { logAdminAction } from '../../util/adminLog'

export async function manualSettlement(req: AuthRequest, res: Response) {
  const batches =
    typeof req.body?.batches === 'number' && req.body.batches > 0
      ? req.body.batches
      : 1

  const result = await runManualSettlement(batches)
  if (req.userId) {
    await logAdminAction(req.userId, 'manualSettlement', null, { batches })
  }
  res.json({ data: result })
}

