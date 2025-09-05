import { Router } from 'express'
import { requireAdminAuth } from '../../middleware/auth'
import {
  manualSettlement,
  startSettlement,
  settlementStatus,
} from '../../controller/admin/settlement.controller'
import { adjustSettlements } from '../../controller/admin/settlementAdjustment.controller'

const router = Router()

router.use(requireAdminAuth)

router.post('/', manualSettlement)
router.post('/start', startSettlement)
router.get('/status/:jobId', settlementStatus)
router.post('/adjust', adjustSettlements)

export default router

