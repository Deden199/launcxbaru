import { Router } from 'express'
import { getBanks } from '../controller/bank.controller'

const router = Router()
router.get('/banks', getBanks)
export default router
