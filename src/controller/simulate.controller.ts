import { Request, Response } from 'express';
import crypto from 'crypto';
import paymentController from './payment';
import { prisma } from '../core/prisma';

export const simulateCallback = async (req: Request, res: Response) => {
  try {
    const { orderId, amount, method = 'qris' } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ success: false, error: 'orderId & amount wajib' });
    }
    // panggil core processing
    const payload = {
      ref_id:            orderId,
      amount,
      method,
      status:            'SUCCESS',
      net_amount:        amount,
      total_fee:         0,
      qr_string:         'qris',
      settlement_status: 'PENDING',
      updated_at:        { value: new Date().toISOString() },
      expires_at:        { value: new Date(Date.now() + 30 * 60_000).toISOString() },
    };

    const orderRecord = await prisma.order.findUnique({
      where: { id: orderId },
      select: { subMerchantId: true },
    });
    if (!orderRecord) {
      return res.status(404).json({ success: false, error: 'Order tidak ditemukan' });
    }

    const sub = await prisma.sub_merchant.findUnique({
      where: { id: orderRecord.subMerchantId! },
      select: { credentials: true },
    });
 if (!sub) {
      return res.status(404).json({ success: false, error: 'Sub-merchant tidak ditemukan' });
    }
    const cred = sub.credentials as { secretKey: string };
    const minimal = JSON.stringify({ ref_id: orderId, amount, method });
    const signature = crypto
      .createHash('md5')
      .update('/api/v1/transactions' + minimal + cred.secretKey, 'utf8')
      .digest('hex');

    const fakeReq: any = {
      rawBody: Buffer.from(JSON.stringify(payload), 'utf8'),
      header(name: string) {
        return name.toLowerCase() === 'x-signature' ? signature : undefined;
      },
    };
    const fakeRes: any = {
      status() {
        return { json: () => Promise.resolve(null) };
      },
    };
    await paymentController.transactionCallback(fakeReq, fakeRes);

    return res.status(200).json({ success: true, message: 'Simulate callback Success' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
