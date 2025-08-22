// src/route/payment.v2.routes.ts
import { Router } from 'express';
import validator from '../validation/validation';
import cardController from '../controller/card.controller';

const paymentRouterV2 = Router();

/**
 * @swagger
 * tags:
 *   - name: V2 Payments (Card)
 *     description: Card Encryption Flow (Create Session, Confirm, 3DS, Get Status)
 */

/**
 * @swagger
 * /v2/payments/session:
 *   post:
 *     summary: Create Card Payment Session
 *     description: Membuat Payment Session untuk kartu dan mengembalikan RSA public key (encryptionKey) untuk enkripsi data kartu di frontend.
 *     tags: [V2 Payments (Card)]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - buyerId
 *               - subMerchantId
 *             properties:
 *               amount:
 *                 type: object
 *                 required: [value, currency]
 *                 properties:
 *                   value:
 *                     type: number
 *                     example: 100000
 *                   currency:
 *                     type: string
 *                     description: 3-letter ISO code
 *                     example: IDR
 *               buyerId:
 *                 type: string
 *                 description: Buyer ID associated with the transaction
 *                 example: b1
 *               subMerchantId:
 *                 type: string
 *                 description: Sub-merchant identifier
 *                 example: s1
 *               customer:
 *                 type: object
 *                 description: Customer info (opsional)
 *                 example:
 *                   givenName: "Reforza"
 *                   sureName: "Geotama"
 *                   email: "reforza@pivot-payment.com"
 *                   phoneNumber:
 *                     countryCode: "+62"
 *                     number: "89699990001"
 *               orderInformation:
 *                 type: object
 *                 description: Order info (opsional)
 *                 example:
 *                   productDetails:
 *                     - type: "PHYSICAL"
 *                       category: "FASHION"
 *                       subCategory: "FASHION WANITA"
 *                       name: "Dress Kasual Warna Putih"
 *                       description: "Ukuran M"
 *                       quantity: 1
 *                       price:
 *                         value: 100000
 *                         currency: "IDR"
 *                   billingInfo:
 *                     givenName: "Reforza"
 *                     email: "reforza@pivot-payment.com"
 *                     city: "Tangerang Regency"
 *                     country: "ID"
 *                     postalCode: "15331"
 *                   shippingInfo:
 *                     givenName: "Reforza"
 *                     method: "REGULAR"
 *                     shippingFee:
 *                       value: 100000
 *                       currency: "IDR"
 *               statementDescriptor:
 *                 type: string
 *                 example: "Reforza Pivot"
 *               expiryAt:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-12-30T23:59:00Z"
 *               metadata:
 *                 type: object
 *                 additionalProperties: true
 *                 example:
 *                   invoiceNo: "INV001"
 *               paymentType:
 *                 type: string
 *                 enum: [SINGLE, RECURRING]
 *                 example: SINGLE
 *     responses:
 *       201:
 *         description: Payment session created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: "sess_123"
 *                 encryptionKey:
 *                   type: string
 *                   description: RSA public key untuk enkripsi kartu (PEM atau base64 yang bisa di-wrap ke PEM)
 *                   example: "Eykc6QYeUuG5aKcPMrUsaZq0bWWCGLJY"
 *       400:
 *         description: Validation error
 *       500:
 *         description: Internal server error
 */
paymentRouterV2.post(
  '/session',
  ...validator.createCardSessionValidation,
  validator.handleValidationErrors,
  cardController.createCardSession
);

/**
 * @swagger
 * /v2/payments/{id}/confirm:
 *   post:
 *     summary: Confirm Card Payment Session
 *     description: Mengirim hasil enkripsi data kartu dan opsi pemrosesan kartu. Jika perlu 3DS, response berisi paymentUrl untuk redirect.
 *     tags: [V2 Payments (Card)]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment Session ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [encryptedCard]
 *             properties:
 *               encryptedCard:
 *                 type: string
 *                 description: Base64 hasil RSA encryption data kartu (PAN/expiry/CVV) dari frontend
 *               paymentMethodOptions:
 *                 type: object
 *                 properties:
 *                   card:
 *                     type: object
 *                     properties:
 *                       captureMethod:
 *                         type: string
 *                         enum: [automatic, manual]
 *                         example: automatic
 *                       threeDsMethod:
 *                         type: string
 *                         enum: [CHALLENGE, AUTO]
 *                         example: CHALLENGE
 *                       processingConfig:
 *                         type: object
 *                         properties:
 *                           bankMerchantId:
 *                             type: string
 *                             nullable: true
 *                           merchantIdTag:
 *                             type: string
 *                             nullable: true
 *     responses:
 *       200:
 *         description: Confirmation accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "PENDING_3DS"
 *                 paymentUrl:
 *                   type: string
 *                   description: URL halaman 3DS jika perlu authentication
 *                   example: "https://creditcard-webview-stg.harsya.com/payment/creditcard/threeds?client_transaction_id=1751620870&acquirer_transaction_id=TRXCC36ac8979a69a17516228851&session_id=FYb9MAxPBhiwsMGEwbtV5SmkF6t2DnWK"
 *       400:
 *         description: Validation error
 *       402:
 *         description: Payment declined
 *       500:
 *         description: Internal server error
 */
paymentRouterV2.post(
  '/:id/confirm',
  ...validator.confirmCardSessionValidation,
  validator.handleValidationErrors,
  cardController.confirmCardSession
);

/**
 * @swagger
 * /v2/payments/{id}:
 *   get:
 *     summary: Get Payment Detail
 *     description: Mengambil detail/status payment berdasarkan ID.
 *     tags: [V2 Payments (Card)]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment found
 *       404:
 *         description: Payment not found
 *       500:
 *         description: Internal server error
 */
paymentRouterV2.get('/:id', cardController.getPayment);

/**
 * @swagger
 * /v2/payments/{payment_id}/status:
 *   get:
 *     summary: Get Payment Status (alias)
 *     description: Alias status endpoint—memetakan {payment_id} ke {id} lalu memanggil getPayment.
 *     tags: [V2 Payments (Card)]
 *     parameters:
 *       - in: path
 *         name: payment_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
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
 *                       example: "IN_PROGRESS"
 *       404:
 *         description: Payment not found
 *       500:
 *         description: Internal server error
 */
paymentRouterV2.get(
  '/:payment_id/status',
  ...validator.getStatusValidation,
  validator.handleValidationErrors,
  (req, res) => {
    // normalisasi param ke "id" agar kompatibel dengan controller.getPayment
    (req as any).params.id = req.params.payment_id;
    return cardController.getPayment(req as any, res);
  }
);

export default paymentRouterV2;
