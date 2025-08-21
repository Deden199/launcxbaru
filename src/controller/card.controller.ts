import { Request, Response } from 'express';
import cardService from '../service/card.service';
import logger from '../logger';

export const createCardSession = async (req: Request, res: Response) => {
  try {
    const { amount, currency, customer, order } = req.body;
    const session = await cardService.createCardSession(
      amount,
      currency,
      customer,
      order
    );
    return res.status(201).json(session);
  } catch (err: any) {
    return res
      .status(err.status || 500)
      .json({ error: err.message || 'Failed to create session' });
  }
};

export const confirmCardSession = async (req: Request, res: Response) => {
  try {
    const { encryptedCard, paymentMethodOptions } = req.body;
    const { id } = req.params;
    const result = await cardService.confirmCardSession(
      id,
      encryptedCard,
      paymentMethodOptions
    );
    if (result.paymentUrl) {
      logger.info(`[CardPayment] 3DS redirect URL: ${result.paymentUrl}`);
    }
    return res.status(200).json(result);
  } catch (err: any) {
    return res
      .status(err.status || 500)
      .json({ error: err.message || 'Failed to confirm session' });
  }
};

export const getPayment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payment = await cardService.getPayment(id);
    return res.status(200).json(payment);
  } catch (err: any) {
    return res
      .status(err.status || 500)
      .json({ error: err.message || 'Failed to fetch payment' });
  }
};

export default { createCardSession, confirmCardSession, getPayment };
