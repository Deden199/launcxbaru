import { Router } from 'express'
import { getBanks } from '../controller/bank.controller'

const router = Router()
router.get('/banks', (req, res) => getBanks(req, res))
export default router
