// src/route/payment.routes.ts
import { Router } from 'express'
import paymentController from '../controller/payment'
import apiKeyAuth from '../middleware/apiKeyAuth'

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     apiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: x-api-key
 *   schemas:
 *     Transaction:
 *       type: object
 *       required:
 *         - merchantName
 *         - price
 *         - buyer
 *         - subMerchantId
 *         - sourceProvider
 *       properties:
 *         merchantName:
 *           type: string
 *           description: gv / hilogate / …
 *         price:
 *           type: number
 *         buyer:
 *           type: string
 *         flow:
 *           type: string
 *           enum: [embed, redirect]
 *         playerId:
 *           type: string
 *         subMerchantId:
 *           type: string
 *         sourceProvider:
 *           type: string
 *     OrderRequest:
 *       type: object
 *       required:
 *         - amount
 *         - userId
 *       properties:
 *         amount:
 *           type: number
 *           minimum: 1
 *         userId:
 *           type: string
 *         playerId:
 *           type: string
 *     OrderResponse:
 *       type: object
 *       properties:
 *         orderId:
 *           type: string
 *         checkoutUrl:
 *           type: string
 *         qrPayload:
 *           type: string
 *         playerId:
 *           type: string
 *         totalAmount:
 *           type: number
 *         expiredTs:
 *           type: string
 *     PaymentStatus:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 */

const paymentRouter = Router()

// Aggregator flow: create an aggregated order
paymentRouter.post(
  '/create-order',
  apiKeyAuth,
  paymentController.createOrder
)
/**
 * @openapi
 * /create-order:
 *   post:
 *     summary: Create an aggregated order
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderRequest'
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 */

// Direct transaction: QR payload or redirect URL
paymentRouter.post(
  '/',
  apiKeyAuth,
  paymentController.createTransaction
)
/**
 * @openapi
 * /:
 *   post:
 *     summary: Create a direct transaction
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Transaction'
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 */

// Payment gateway callback for transactions
paymentRouter.post(
  '/transaction/callback',
  paymentController.transactionCallback
)
/**
 * @openapi
 * /transaction/callback:
 *   post:
 *     summary: Payment gateway callback
 *     responses:
 *       200:
 *         description: Callback processed
 */

// Retrieve order details by ID
paymentRouter.get(
  '/order/:id',
  apiKeyAuth,
  paymentController.getOrder
)
/**
 * @openapi
 * /order/{id}:
 *   get:
 *     summary: Retrieve order details by ID
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 */
paymentRouter.post(
  '/transaction/callback/gidi',
  paymentController.gidiTransactionCallback,
)
/**
 * @openapi
 * /transaction/callback/gidi:
 *   post:
 *     summary: GIDI payment callback
 *     responses:
 *       200:
 *         description: Callback processed
 */

// Check payment status by order ID
paymentRouter.get(
  '/order/:id/status',
  apiKeyAuth,
  paymentController.checkPaymentStatus
)
/**
 * @openapi
 * /order/{id}/status:
 *   get:
 *     summary: Check payment status by order ID
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentStatus'
 */
paymentRouter.post(
  '/transaction/callback/oy/retry/:referenceId',
  paymentController.retryOyCallback
);
/**
 * @openapi
 * /transaction/callback/oy/retry/{referenceId}:
 *   post:
 *     summary: Retry OY! callback
 *     parameters:
 *       - in: path
 *         name: referenceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Retry processed
 */

export default paymentRouter
