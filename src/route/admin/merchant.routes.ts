// src/routes/admin/merchant.routes.ts
import { Router, Request, Response, NextFunction } from 'express'
import * as ctrl from '../../controller/admin/merchant.controller'
import * as exportCtrl from '../../controller/admin/merchant.controller'
import { authMiddleware, AuthRequest, requireSuperAdminAuth } from '../../middleware/auth'
import { adminIpWhitelist } from '../../middleware/ipWhitelist'
import subMerchantRouter from './subMerchant.routes'   // ← import

const router = Router()

// Semua route berikut hanya untuk ADMIN
router.use(authMiddleware, (req: Request, res: Response, next: NextFunction) => {
  const { userRole } = req as AuthRequest
  if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
})

// Regenerate API Key untuk partner clients
router.post('/api-key', ctrl.regenerateApiKey)

// Merchant CRUD
router.post('/',    ctrl.createMerchant)
router.get('/',     ctrl.getAllMerchants)
router.get('/allclient',     ctrl.getAllClient)

router.get('/:merchantId/balances', ctrl.getMerchantBalances)

router.get('/:id',  ctrl.getMerchantById)
router.patch('/:id',      ctrl.updateMerchant)
router.patch('/:id/fee',  ctrl.setFeeRate)
router.delete('/:id',     ctrl.deleteMerchant)

// Manage PG connectioncs (sub-merchant)
router.get('/:id/pg',           ctrl.listPGs)
router.post('/:id/pg',          ctrl.connectPG)
router.patch('/:id/pg/:subId',  ctrl.updatePGFee)
router.delete('/:id/pg/:subId', ctrl.disconnectPG)
router.use('/:id/pg', subMerchantRouter)

// Admin Dashboard: transaksi, summary, profit, withdrawals, export
router.get('/dashboard/transactions', ctrl.getDashboardTransactions)
router.get('/dashboard/summary',      ctrl.getDashboardSummary)
router.get('/dashboard/profit',       ctrl.getPlatformProfit)
router.get('/dashboard/profit-submerchant', ctrl.getProfitPerSubMerchant)

router.get('/dashboard/withdrawals',  ctrl.getDashboardWithdrawals)
router.post('/dashboard/withdraw', adminIpWhitelist, requireSuperAdminAuth, ctrl.adminWithdraw)
router.post(
  '/dashboard/validate-account',
  requireSuperAdminAuth,
  ctrl.adminValidateAccount
)
router.get(
  '/dashboard/admin-withdrawals',
  requireSuperAdminAuth,
  ctrl.getAdminWithdrawals
)
router.get('/dashboard/export-all',   exportCtrl.exportDashboardAll)

export default router
