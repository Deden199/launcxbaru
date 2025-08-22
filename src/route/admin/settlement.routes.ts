import { Router } from 'express'
import { requireAdminAuth } from '../../middleware/auth'
import { manualSettlement } from '../../controller/admin/settlement.controller'

const router = Router()

router.use(requireAdminAuth)

router.post('/', manualSettlement)

export default router

