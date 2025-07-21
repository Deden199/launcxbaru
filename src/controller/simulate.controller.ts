// src/routes/simulate.ts
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { transactionCallback } from './payment'; // make sure this is a named export
import { prisma } from '../core/prisma';
import logger from '../logger';

export const simulateCallback = async (
  req: Request,
  res: Response
) => {
  try {
    // 1) We’re using express.raw() on this route,
    //    so req.body is still a Buffer called rawBody.
    const rawBody = (req as any).rawBody.toString('utf8');
    logger.debug('[Simulate] rawBody:', rawBody);

    // 2) Parse the JSON just like production does
    const full = JSON.parse(rawBody);
    const { ref_id, amount, method = 'qris' } = full;
    if (!ref_id || amount == null) {
      return res
        .status(400)
        .json({ success: false, error: 'ref_id & amount are required' });
    }

    // 3) Lookup sub-merchant to get its secretKey
    const orderRecord = await prisma.order.findUnique({
      where: { id: ref_id },
      select: { subMerchantId: true }
    });
    if (!orderRecord) {
      return res
        .status(404)
        .json({ success: false, error: 'Order not found' });
    }
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: orderRecord.subMerchantId! },
      select: { credentials: true }
    });
    if (!sub) {
      return res
        .status(404)
        .json({ success: false, error: 'Sub-merchant not found' });
    }
    const { secretKey } = sub.credentials as { secretKey: string };

    // 4) Compute the MD5 signature exactly as production does
    const minimal = JSON.stringify({ ref_id, amount, method });
    const signature = crypto
      .createHash('md5')
      .update('/api/v1/transactions' + minimal + secretKey, 'utf8')
      .digest('hex');

    // 5) Inject it back into headers so transactionCallback can verify it
    req.headers['x-signature'] = signature;

    // 6) Override req.body with our parsed JSON
    (req as any).body = full;

    // 7) Delegate to the real production handler
    //    NOTE: we only pass (req, res), since transactionCallback is declared as (req, res)
    return transactionCallback(req, res);
  } catch (err: any) {
    logger.error('[Simulate] error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
