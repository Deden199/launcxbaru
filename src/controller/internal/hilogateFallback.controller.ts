import { Request, Response } from 'express';
import { prisma } from '../../core/prisma';
import { HilogateClient, HilogateConfig } from '../../service/hilogateClient';
import logger from '../../logger';

export async function manualResendCallback(req: Request, res: Response) {
  const { refId } = req.params;
  try {
    // 1) Find transaction to get subMerchantId
    const trx = await prisma.transaction_request.findUnique({
      where: { id: refId },
      select: { subMerchantId: true },
    });
    if (!trx) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // 2) Fetch sub-merchant credentials
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: trx.subMerchantId },
      select: { credentials: true },
    });
    if (!sub || !sub.credentials) {
      return res.status(500).json({ message: 'Hilogate credentials not found' });
    }

    // 3) Parse credentials to HilogateConfig
    let cfg: HilogateConfig;
    const raw = sub.credentials as any;
    if (typeof raw === 'string') {
      cfg = JSON.parse(raw);
    } else {
      cfg = raw as HilogateConfig;
    }

    const client = new HilogateClient(cfg);
    const result = await client.resendCallback(refId);
    logger.info('[manualResendCallback] result', { refId, result });

    return res.json({ success: true, result });
  } catch (err: any) {
    logger.error('[manualResendCallback] error', { refId, error: err?.message });
    return res.status(500).json({ message: 'Failed to resend callback' });
  }
}
