import { Request, Response } from 'express';
import cardService from '../service/card.service';
import logger from '../logger';

/** Support amount in two shapes:
 *  - new: { amount: { value, currency }, ... }
 *  - legacy: { amount: number, currency: string, ... }
 */
function parseAmountCurrency(body: any): { amountValue: number; currency: string } {
  const amt = body?.amount;

  // New shape
  if (amt && typeof amt === 'object') {
    const value = Number(amt.value);
    const ccy = String(amt.currency || body.currency || 'IDR').toUpperCase();
    if (!value || value <= 0) throw new Error('amount.value must be > 0');
    return { amountValue: Math.round(value), currency: ccy };
  }

  // Legacy shape
  const value = Number(amt);
  const ccy = String(body?.currency || 'IDR').toUpperCase();
  if (!value || value <= 0) throw new Error('amount must be > 0');
  return { amountValue: Math.round(value), currency: ccy };
}

export const createCardSession = async (req: Request, res: Response) => {
  try {
    const { amountValue, currency } = parseAmountCurrency(req.body);

    const customer = req.body?.customer;
    const orderInfo = req.body?.orderInformation ?? req.body?.order ?? undefined;

    const buyerId = req.body?.buyerId;
    const subMerchantId = req.body?.subMerchantId;
    const playerId = req.body?.playerId;
    if (!buyerId || !subMerchantId) {
      return res.status(400).json({ error: 'Missing buyerId or subMerchantId' });
    }

    const session = await cardService.createCardSession(
      amountValue,
      currency,
      customer,
      orderInfo,
      {
        statementDescriptor: req.body?.statementDescriptor,
        expiryAt: req.body?.expiryAt,
        metadata: req.body?.metadata,
        paymentType: req.body?.paymentType, // service akan default 'SINGLE' jika undefined
        clientReferenceId: req.body?.clientReferenceId,
      },
      { buyerId, subMerchantId, playerId }
    );

    // Pastikan FE selalu dapat { id, encryptionKey }
    const id =
      session?.id ?? session?.data?.id ?? session?.result?.id ?? session?.paymentSession?.id;
    const encryptionKey =
      session?.encryptionKey ??
      session?.data?.encryptionKey ??
      session?.result?.encryptionKey ??
      session?.paymentSession?.encryptionKey ??
      session?.publicKey ??
      session?.rsaPublicKey ??
      session?.encryption?.publicKey;

    if (!id || !encryptionKey) {
      logger.error('[createCardSession] Missing id/encryptionKey', { session });
      return res.status(502).json({ error: 'Provider did not return encryptionKey' });
    }

    // Kembalikan bentuk stabil yang dipakai FE
    return res.status(201).json({ id, encryptionKey });
  } catch (err: any) {
    logger.error('[createCardSession] error', { err: err?.response?.data || err?.message });
    return res
      .status(err?.status || 500)
      .json({ error: err?.message || 'Failed to create session' });
  }
};

export const confirmCardSession = async (req: Request, res: Response) => {
  try {
    const { encryptedCard, paymentMethodOptions } = req.body || {};
    const { id } = req.params;

    if (!id) return res.status(400).json({ error: 'Missing payment session id' });
    if (!encryptedCard || typeof encryptedCard !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid encryptedCard' });
    }

    const result = await cardService.confirmCardSession(id, encryptedCard, paymentMethodOptions);

    if (result?.paymentUrl) {
      logger.info(`[CardPayment] 3DS redirect URL: ${result.paymentUrl}`);
    }

    return res.status(200).json(result);
  } catch (err: any) {
    return res
      .status(err?.status || 500)
      .json({ error: err?.message || 'Failed to confirm session' });
  }
};

export const getPayment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing payment id' });

    const payment = await cardService.getPayment(id);
    return res.status(200).json(payment);
  } catch (err: any) {
    return res
      .status(err?.status || 500)
      .json({ error: err?.message || 'Failed to fetch payment' });
  }
};

export default { createCardSession, confirmCardSession, getPayment };
