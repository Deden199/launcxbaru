import { Response } from 'express'
import { runManualSettlement, resetSettlementState, restartSettlementChecker } from '../../cron/settlement'
import { AuthRequest } from '../../middleware/auth'
import { logAdminAction } from '../../util/adminLog'
import { startSettlementJob, getSettlementJob } from '../../worker/settlementJob'

export async function manualSettlement(req: AuthRequest, res: Response) {
  resetSettlementState()
  const actor = req.userId ?? 'admin'
  const result = await runManualSettlement({
    context: { actor, trigger: 'manual', jobId: `manual:${Date.now()}` },
  })
  restartSettlementChecker('')
  if (req.userId) {
    await logAdminAction(req.userId, 'manualSettlement', null, result)
  }
  res.json({ data: result })
}

export async function startSettlement(req: AuthRequest, res: Response) {
  const jobId = startSettlementJob({ actor: req.userId ?? 'admin' })
  if (req.userId) {
    await logAdminAction(req.userId, 'manualSettlementStart', null, { jobId })
  }
  res.json({ data: { jobId } })
}

export function settlementStatus(req: AuthRequest, res: Response) {
  const job = getSettlementJob(req.params.jobId)
  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }
  const { settledOrders, netAmount, status } = job
  res.json({ data: { settledOrders, netAmount, status } })
}

