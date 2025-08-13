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

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     clientAuth:
 *       type: http
 *       scheme: bearer
 *   schemas:
 *     ValidateAccountRequest:
 *       type: object
 *       required:
 *         - bank_code
 *         - account_number
 *       properties:
 *         bank_code:
 *           type: string
 *           pattern: '^[0-9]{3}$'
 *         account_number:
 *           type: string
 *     WithdrawalRequest:
 *       type: object
 *       required:
 *         - amount
 *         - account_no
 *         - bank_code
 *         - currency
 *         - request_id
 *       properties:
 *         amount:
 *           type: integer
 *           minimum: 1
 *         account_no:
 *           type: string
 *         bank_code:
 *           type: string
 *           pattern: '^[0-9]{3}$'
 *         currency:
 *           type: string
 *           minLength: 3
 *           maxLength: 3
 *         description:
 *           type: string
 *         request_id:
 *           type: string
 *           format: uuid
 *     WithdrawalResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         status:
 *           type: string
 */

const router = Router()

// All these need the client to be authenticated
router.use(requireClientAuth)

// 1) Validate account
router.post(
  '/validate-account',
  express.json(),
  validateAccount
)
/**
 * @openapi
 * /validate-account:
 *   post:
 *     summary: Validate destination account
 *     security:
 *       - clientAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ValidateAccountRequest'
 *     responses:
 *       200:
 *         description: Account validated
 */

// 2) Create a new withdrawal
router.post(
  '/',
  express.json(),
  requestWithdraw
)
/**
 * @openapi
 * /:
 *   post:
 *     summary: Create a new withdrawal
 *     security:
 *       - clientAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WithdrawalRequest'
 *     responses:
 *       200:
 *         description: Withdrawal created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WithdrawalResponse'
 */

// 3) List all withdrawals for this client
router.get(
  '/',
  listWithdrawals
)
/**
 * @openapi
 * /:
 *   get:
 *     summary: List all withdrawals for this client
 *     security:
 *       - clientAuth: []
 *     responses:
 *       200:
 *         description: List of withdrawals
 */
router.get('/submerchants', listSubMerchants)
/**
 * @openapi
 * /submerchants:
 *   get:
 *     summary: List sub merchants
 *     security:
 *       - clientAuth: []
 *     responses:
 *       200:
 *         description: List of sub merchants
 */


// 4) Retry a failed withdrawal
router.post(
  '/:id/retry',
  express.json(),
  retryWithdrawal
)
/**
 * @openapi
 * /{id}/retry:
 *   post:
 *     summary: Retry a failed withdrawal
 *     security:
 *       - clientAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Retry initiated
 */

export default router
