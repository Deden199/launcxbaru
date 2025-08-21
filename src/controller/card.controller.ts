import { Request, Response } from 'express';
import cardService from '../service/card.service';
import logger from '../logger';

export const createCardSession = async (_req: Request, res: Response) => {
  try {
    const session = await cardService.createCardSession();
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

export default { createCardSession, confirmCardSession };
