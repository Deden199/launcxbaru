// src/routes/admin/subMerchant.routes.ts
import { Router } from 'express'
import * as ctrl from '../../controller/admin/subMerchant.controller'
import { authMiddleware, AuthRequest } from '../../middleware/auth'

const router = Router({ mergeParams: true })  // penting!

// Semua route di sini memakai same auth & require ADMIN
router.use(authMiddleware, (req: AuthRequest, res, next) => {
  if (req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' })
  next()
})

// GET    /api/v1/admin/merchant/:id/pg       → listPGs
// POST   /api/v1/admin/merchant/:id/pg       → connectPG
// DELETE /api/v1/admin/merchant/:id/pg/:subId→ disconnectPG
router.get  ('/',       ctrl.listSubMerchants)
router.post ('/',       ctrl.createSubMerchant)
router.delete('/:subId', ctrl.deleteSubMerchant)
router.patch ('/:subId',  ctrl.updateSubMerchant)   // ← tambahkan ini

export default router
