import express, { Router } from 'express'
import {
  clientRegister,
  clientLogin
} from '../../controller/clientAuth.controller'
import { requireClientAuth } from '../../middleware/clientAuth'
import {
  getClientDashboard,
  exportClientTransactions,
  getClientCallbackUrl,
  updateClientCallbackUrl
} from '../../controller/clientDashboard.controller'
import withdrawalRoutes from '../withdrawals.routes'

const r = Router()

// 1) Public: register & login
r.post('/register', clientRegister)
r.post('/login',    clientLogin)

// 2) Protected: semua route berikut butuh token PARTNER_CLIENT
r.use(requireClientAuth)

// Callback settings
r.get('/callback-url', getClientCallbackUrl)
r.post('/callback-url', express.json(), updateClientCallbackUrl)

// Dashboard (saldo + transaksi)
r.get('/dashboard', getClientDashboard)
r.get('/dashboard/export', exportClientTransactions)

// Withdrawal endpoints
r.use('/withdrawals', withdrawalRoutes)

export default r
