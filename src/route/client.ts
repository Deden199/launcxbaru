// src/routes/client.ts
import express, { Router } from 'express'
import { clientLogin, clientRegister } from '../controller/clientAuth.controller'
import { requireClientAuth }        from '../middleware/clientAuth'
import { getClientDashboard }       from '../controller/clientDashboard.controller'
import {
  validateAccount,
  requestWithdraw,
  listWithdrawals,
  retryWithdrawal
} from '../controller/withdrawals.controller'

const r = Router()

// Public
r.post('/register', clientRegister)
r.post('/login',    clientLogin)

// Protect all below
r.use(requireClientAuth)

// Dashboard
r.get('/dashboard', getClientDashboard)

// Withdrawal endpoints
r.post(
  '/withdrawals/validate-account',
  express.json(),
  validateAccount
)
r.post(
  '/withdrawals',
  express.json(),
  requestWithdraw
)
r.get(
  '/withdrawals',
  listWithdrawals
)
r.post(
  '/withdrawals/:id/retry',
  express.json(),
  retryWithdrawal
)

export default r
