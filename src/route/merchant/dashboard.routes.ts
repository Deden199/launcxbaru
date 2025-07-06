import { Router } from 'express'
import { authMiddleware } from '../../middleware/auth'
import { getStats, getTransactions, exportTransactions } from '../../controller/merchant/dashboard.controller'
const router = Router()

router.use(authMiddleware)
router.get('/stats', getStats)
router.get('/transactions', getTransactions)
router.get('/transactions/export', exportTransactions)

export default router
