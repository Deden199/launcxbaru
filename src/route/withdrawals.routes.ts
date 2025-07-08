// src/route/client/withdrawals.routes.ts

import express, { Router } from 'express'
import { requireClientAuth } from '../middleware/clientAuth'
import {
  validateAccount,
  requestWithdraw,
  listWithdrawals,
  retryWithdrawal,
  listSubMerchants,
} from '../controller/withdrawals.controller'

const router = Router()

// All these need the client to be authenticated
router.use(requireClientAuth)

// 1) Validate account
router.post(
  '/validate-account',
  express.json(),
  validateAccount
)

// 2) Create a new withdrawal
router.post(
  '/',
  express.json(),
  requestWithdraw
)

// 3) List all withdrawals for this client
router.get(
  '/',
  listWithdrawals
)
router.get('/submerchants', listSubMerchants)


// 4) Retry a failed withdrawal
router.post(
  '/:id/retry',
  express.json(),
  retryWithdrawal
)

export default router
