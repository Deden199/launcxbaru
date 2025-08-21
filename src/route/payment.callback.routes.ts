import { Router } from 'express';
import pivotCallbackAuth from '../middleware/pivotCallbackAuth';
import { pivotPaymentCallback } from '../controller/pivotCallback.controller';

const pivotCallbackRouter = Router();

/**
 * @swagger
 * /v2/payments/callback/pivot:
 *   post:
 *     summary: Pivot Payment Callback
 *     description: Endpoint untuk menerima callback status pembayaran dari Pivot.
 *     tags:
 *       - V2 Payment
 *     security: []
 *     parameters:
 *       - in: header
 *         name: X-API-Key
 *         required: true
 *         schema:
 *           type: string
 *         description: Callback API Key (server-to-server)
 *     requestBody:
 *       description: Callback body from Pivot
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [event, data]
 *             properties:
 *               event:
 *                 type: string
 *                 enum: [PAYMENT.PROCESSING, PAYMENT.PAID, CHARGE.SUCCESS, PAYMENT.CANCELLED]
 *               data:
 *                 type: object
 *                 description: Payment Session data dari Pivot
 *     responses:
 *       '200':
 *         description: Acknowledged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       '401':
 *         description: Unauthorized (invalid X-API-Key)
 *       '400':
 *         description: Bad request (invalid payload)
 *       '500':
 *         description: Server error
 */
pivotCallbackRouter.post(
  '/callback/pivot',
  pivotCallbackAuth,
  // JSON parser khusus callback
  // (Kalau kamu butuh raw body untuk verifikasi signature, tambah verify di sini)
  (req, res, next) => {
    // batasan ukuran & content-type sudah diatur global, tapi kita pastikan
    if (!req.is('application/json')) {
      return res.status(415).json({ ok: false, error: 'Unsupported Media Type' });
    }
    next();
  },
  // express.json() sudah dipasang global di app.ts; kalau belum, aktifkan di sini:
  // express.json({ limit: '200kb' }),
  pivotPaymentCallback
);

export default pivotCallbackRouter;
