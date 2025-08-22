import { Router } from 'express'
import { requireAdminAuth } from '../../middleware/auth'
import {
  manualSettlement,
  startSettlement,
  settlementStatus,
} from '../../controller/admin/settlement.controller'

const router = Router()

router.use(requireAdminAuth)

router.post('/', manualSettlement)
router.post('/start', startSettlement)
router.get('/status/:jobId', settlementStatus)

export default router

