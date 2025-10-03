import { Router } from 'express'
import { requireAdminAuth } from '../../middleware/auth'
import {
  manualSettlement,
  startSettlement,
  settlementStatus,
  previewSettlement,
  cancelSettlement,
  downloadSettlementSummary,
} from '../../controller/admin/settlement.controller'
import {
  adjustSettlements,
  getEligibleSettlements,
  reverseSettlementToLnSettle,
  settlementAdjustmentStatus,
  startSettlementAdjustmentJob,
} from '../../controller/admin/settlementAdjustment.controller'

const router = Router()

router.use(requireAdminAuth)

router.post('/', manualSettlement)
router.post('/preview', previewSettlement)
router.post('/start', startSettlement)
router.get('/status/:jobId', settlementStatus)
router.post('/cancel/:jobId', cancelSettlement)
router.get('/export/:jobId', downloadSettlementSummary)
router.post('/adjust', adjustSettlements)
router.post('/adjust/job', startSettlementAdjustmentJob)
router.get('/adjust/job/:jobId', settlementAdjustmentStatus)
router.get('/eligible', getEligibleSettlements)
router.post('/reverse-to-ln-settle', reverseSettlementToLnSettle)

export default router

