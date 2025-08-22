import { Router, json, Request, Response, NextFunction } from 'express';
import { pivotPaymentCallback } from '../controller/pivotCallback.controller';

const pivotCallbackRouter = Router();

// Parser JSON khusus route ini (longgar + limit besar)
const jsonParser = json({
  limit: '1mb',
  type: (req) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    // izinkan application/json, */json, +json, dan tanpa content-type (beberapa proxy)
    return (
      ct === '' ||
      ct.includes('application/json') ||
      ct.endsWith('/json') ||
      ct.includes('+json')
    );
  },
});

// (Opsional) debug tipis; boleh dihapus kalau sudah stabil
function debugBody(req: Request, _res: Response, next: NextFunction) {
  (req as any)._ct = req.headers['content-type'];
  next();
}

/**
 * @swagger
 * /api/v1/payments/callback/pivot:
 *   post:
 *     summary: Pivot Payment Callback
 *     description: Endpoint untuk menerima callback status pembayaran dari Pivot.
 *     tags:
 *       - V2 Payment
 *     security: []
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
 *       '400':
 *         description: Bad request (invalid payload)
 *       '500':
 *         description: Server error
 */
pivotCallbackRouter.post(
  '/callback/pivot',
  debugBody,
  jsonParser,
  pivotPaymentCallback
);

export default pivotCallbackRouter;
