import { Router } from 'express'
import { manualResendCallback } from '../controller/internal/hilogateFallback.controller'

const router = Router()
router.post('/hilogate/resend-callback/:refId', manualResendCallback)

export default router