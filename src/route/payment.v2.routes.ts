import validator from '../validation/validation';
import { Router } from 'express';


const paymentRouterV2 = Router();

/**
 * @swagger
 * /v2/payments/initiate:
 *   post:
 *     summary: Initiate a payment
 *     description: Creates a payment request with the specified details.
 *     tags:
 *       - V2 Payment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - currency
 *               - payment_method
 *               - merchant_id
 *               - request_id
 *             properties:
 *               amount:
 *                 type: integer
 *                 description: The amount of the payment.
 *                 example: 10000
 *               currency:
 *                 type: string
 *                 description: The currency of the payment.
 *                 example: IDR
 *               payment_method:
 *                 type: string
 *                 description: The payment method to use.
 *                 example: qris
 *               merchant_id:
 *                 type: string
 *                 description: The merchant ID associated with the payment.
 *                 example: "1234"
 *               request_id:
 *                 type: string
 *                 description: The unique request ID for each payment.
 *                 example: "a346a673-8a66-4719-a207-237af487996d"
 *     responses:
 *       '200':
 *         description: Payment initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 result:
 *                   type: object
 *                   properties:
 *                     qrImage:
 *                       type: string
 *                       description: Base64 encoded QR code image.
 *                       example: "data:image/png;base64,iVBORw0KGgoAAA..."
 *                     totalAmount:
 *                       type: integer
 *                       description: The total payment amount.
 *                       example: 10000
 *                     expiredTs:
 *                       type: string
 *                       format: date-time
 *                       description: The expiry timestamp of the payment.
 *                       example: "2024-12-08T11:42:45.673Z"
 *                     referenceNo:
 *                       type: string
 *                       description: The reference number for the payment.
 *                       example: "674f15e8f2aeb23f719635d8"
 *       '400':
 *         description: Bad request due to validation errors
 *       '500':
 *         description: Internal server error
 */
paymentRouterV2.post(
    '/initiate',
    ...validator.initiatePaymentValidation,
    validator.handleValidationErrors,
);

/**
 * @swagger
 * /v2/payments/{payment_id}/status:
 *   get:
 *     summary: Get payment status
 *     description: Retrieves the status of a payment based on its ID.
 *     tags:
 *       - V2 Payment
 *     parameters:
 *       - name: payment_id
 *         in: path
 *         required: true
 *         description: The unique identifier of the payment.
 *         schema:
 *           type: string
 *           example: "66ea739d18ab171be1a24761"
 *     responses:
 *       '200':
 *         description: Payment status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 result:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       description: The current status of the payment.
 *                       example: "IN_PROGRESS"
 *       '404':
 *         description: Payment not found
 *       '500':
 *         description: Internal server error
 */
paymentRouterV2.get(
    '/:payment_id/status',
    ...validator.getStatusValidation,
    validator.handleValidationErrors,
);

export default paymentRouterV2;