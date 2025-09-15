import express, { Router } from 'express'
import apiKeyAuth from '../middleware/apiKeyAuth'
import { verifySignature } from '../middleware/verifySignature'
import { s2sIpWhitelist } from '../middleware/ipWhitelist'
import {
  requestWithdrawS2S,
  listWithdrawalsS2S,
  validateAccountS2S,
} from '../controller/withdrawals.controller'

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     apiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: X-API-Key
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

router.use(apiKeyAuth, s2sIpWhitelist, verifySignature)

router.post('/withdrawals', express.json(), requestWithdrawS2S)
/**
 * @openapi
 * /withdrawals:
 *   post:
 *     summary: Create a new withdrawal
 *     security:
 *       - apiKeyAuth: []
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

router.get('/withdrawals', listWithdrawalsS2S)
/**
 * @openapi
 * /withdrawals:
 *   get:
 *     summary: List all withdrawals for this client
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: ref
 *         schema:
 *           type: string
 *         description: Filter by partial reference ID (case-insensitive)
 *     responses:
 *       200:
 *         description: List of withdrawals
 */

router.post('/withdrawals/validate-account', express.json(), validateAccountS2S)
/**
 * @openapi
 * /withdrawals/validate-account:
 *   post:
 *     summary: Validate destination account
 *     security:
 *       - apiKeyAuth: []
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

export default router
