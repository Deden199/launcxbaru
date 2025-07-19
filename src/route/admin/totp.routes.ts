import express, { Router } from 'express'
import { requireAdminAuth } from '../../middleware/auth'
import { setupAdminTOTP, enableAdminTOTP, getAdminTOTPStatus } from '../../controller/admin/totp.controller'

const r = Router()

r.use(requireAdminAuth)

r.post('/setup', setupAdminTOTP)
r.post('/enable', express.json(), enableAdminTOTP)
r.get('/status', getAdminTOTPStatus)

export default r