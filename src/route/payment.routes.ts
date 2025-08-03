// src/route/payment.routes.ts
import { Router } from 'express'
import paymentController from '../controller/payment'
import apiKeyAuth from '../middleware/apiKeyAuth'

const paymentRouter = Router()

// Aggregator flow: create an aggregated order
paymentRouter.post(
  '/create-order',
  apiKeyAuth,
  paymentController.createOrder
)

// Direct transaction: QR payload or redirect URL
paymentRouter.post(
  '/',
  apiKeyAuth,
  paymentController.createTransaction
)

// Payment gateway callback for transactions
paymentRouter.post(
  '/transaction/callback',
  paymentController.transactionCallback
)

// Retrieve order details by ID
paymentRouter.get(
  '/order/:id',
  apiKeyAuth,
  paymentController.getOrder
)
paymentRouter.post(
  '/transaction/callback/gidi',
  paymentController.gidiTransactionCallback,
)

// Check payment status by order ID
paymentRouter.get(
  '/order/:id/status',
  apiKeyAuth,
  paymentController.checkPaymentStatus
)
paymentRouter.post(
  '/transaction/callback/oy/retry/:referenceId',
  paymentController.retryOyCallback
);

export default paymentRouter
