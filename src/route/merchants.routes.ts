import { Router } from 'express'
import {
  listMerchants,
  createMerchant,
  updateMerchant,
  deleteMerchant
} from '../controller/merchants.controller'
import { authMiddleware } from '../middleware/auth'

const router = Router()
router.use(authMiddleware)
router.get('/', listMerchants)
router.post('/', createMerchant)
router.put('/:id', updateMerchant)
router.delete('/:id', deleteMerchant)
export default router
