import { Request, Response } from 'express';
import cardService from '../service/card.service';
import logger from '../logger';

export const createCardSession = async (req: Request, res: Response) => {
  try {
    const {
      // Skema baru (sesuai dok)
      amount: amountObj,
      customer,
      orderInformation,

      // Backward compatibility (skema lama)
      amount: amountLegacy,
      currency: currencyLegacy,
      order,

      // Opsional sesuai contoh dok
      statementDescriptor,
      expiryAt,
      metadata,
      paymentType,
    } = req.body || {};

    // Normalisasi amount & currency:
    // - Utamakan skema baru: amount: { value, currency }
    // - Fallback ke skema lama: amount (number) + currency (string)
    const amountValue =
      (amountObj && typeof amountObj.value === 'number' && amountObj.value) ??
      (typeof amountLegacy === 'number' ? amountLegacy : undefined);

    const currency =
      (amountObj && typeof amountObj.currency === 'string' && amountObj.currency) ??
      (typeof currencyLegacy === 'string' ? currencyLegacy : undefined);

    if (!amountValue || !currency) {
      return res.status(400).json({
        error:
          'Invalid amount/currency. Expected amount.value:number and amount.currency:string (or legacy amount:number + currency:string).',
      });
    }

    // Normalisasi orderInformation (sesuai dok). Fallback ke field lama `order`.
    const orderInfo = orderInformation ?? order ?? undefined;

    const session = await cardService.createCardSession(
      amountValue,
      currency,
      customer,
      orderInfo,
      {
        statementDescriptor,
        expiryAt,
        metadata,
        paymentType, // default ke 'SINGLE' di service bila undefined
      }
    );

    return res.status(201).json(session);
  } catch (err: any) {
    return res
      .status(err?.status || 500)
      .json({ error: err?.message || 'Failed to create session' });
  }
};

export const confirmCardSession = async (req: Request, res: Response) => {
  try {
    const { encryptedCard, paymentMethodOptions } = req.body || {};
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing payment session id' });
    }
    if (!encryptedCard || typeof encryptedCard !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid encryptedCard' });
    }

    const result = await cardService.confirmCardSession(
      id,
      encryptedCard,
      paymentMethodOptions
    );

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
    if (!id) {
      return res.status(400).json({ error: 'Missing payment id' });
    }
    const payment = await cardService.getPayment(id);
    return res.status(200).json(payment);
  } catch (err: any) {
    return res
      .status(err?.status || 500)
      .json({ error: err?.message || 'Failed to fetch payment' });
  }
};

export default { createCardSession, confirmCardSession, getPayment };
