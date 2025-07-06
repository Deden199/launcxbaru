import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { EwalletService, CreateEwalletParams } from '../service/ewallet.service';

const svc = new EwalletService();
const prisma = new PrismaClient();

/**
 * POST /api/v1/ewallet/transaction
 * Body: { merchantId, subMerchantId, buyerId, partnerTrxId, amount, ewalletCode, email?, redirectUrl, expiration? }
 */
export const createEwallet = async (req: Request, res: Response) => {
  try {
    const params = req.body as CreateEwalletParams;
    const data = await svc.createEwalletTransaction(params);
    return res.status(201).json(data);
  } catch (error: any) {
    console.error('createEwallet error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/v1/ewallet/callback
 * Callback from OY! after payment
 */
export const callbackEwallet = async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload.success) {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    // Parse settlement_time (format dd/MM/yyyy'T'HH:mm:ss.SSSZZZZ)
    const [datePart, timePart] = payload.settlement_time.split('T');
    const [day, month, year] = datePart.split('/');
    const settlementAt = new Date(`${year}-${month}-${day}T${timePart}`);

    if (isNaN(settlementAt.getTime())) {
      console.error('Invalid settlement_time format:', payload.settlement_time);
      return res.status(400).json({ error: 'Invalid settlement_time format' });
    }

    await prisma.transaction_request.updateMany({
      where: { trxId: payload.trx_id },
      data: {
        status:       payload.settlement_status,
        settlementAt: settlementAt
      }
    });

    return res.sendStatus(200);
  } catch (error: any) {
    console.error('callbackEwallet error:', error);
    return res.status(500).end();
  }
};
