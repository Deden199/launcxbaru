import { Router } from 'express'
import { listTransactions, syncTransaction } from '../controller/transactions.controller'
import { authMiddleware } from '../middleware/auth'

const router = Router()
router.use(authMiddleware)
router.get('/', listTransactions)
router.post('/:ref_id/sync', syncTransaction)
export default router
