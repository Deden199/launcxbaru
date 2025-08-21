import { Request, Response } from 'express';
import logger from '../logger';
import { PivotCallbackBody } from '../types/pivot-callback';
import cardService from '../service/card.service';

/**
 * Handler untuk menerima callback dari Pivot.
 * Sesuai dok: header X-API-Key, body JSON berisi { event, data {...} }
 */
export const pivotPaymentCallback = async (req: Request, res: Response) => {
  try {
    const body = req.body as PivotCallbackBody;
    if (!body || !body.event || !body.data || !body.data.id) {
      return res.status(400).json({ ok: false, error: 'Invalid callback payload' });
    }

    // Log singkat
    logger.info(`[PivotCallback] event=${body.event} id=${body.data.id} status=${body.data.status}`);

    // (Opsional) tarik status terbaru dari provider untuk memastikan sinkron
    try {
      const latest = await cardService.getPayment(body.data.id);
      // TODO: update DB kamu dengan "latest" (map status, amounts, dsb.)
      // await Payments.upsertFromPivot(latest)
      logger.info('[PivotCallback] Fetched latest provider status', { id: body.data.id });
    } catch (e: any) {
      // Kalau GET gagal, tetap ack agar Pivot tidak replay berulang.
      logger.warn('[PivotCallback] getPayment failed; proceed with callback body data', {
        id: body.data.id,
        err: e?.response?.data || e?.message,
      });
      // TODO: fallback update DB pakai body.data langsung
    }

    // NOTE: kembalikan 200 OK cepat agar Pivot tidak timeout/retry
    return res.json({ ok: true });
  } catch (err: any) {
    logger.error('[PivotCallback] error', { err: err?.response?.data || err?.message });
    return res.status(500).json({ ok: false });
  }
};

export default { pivotPaymentCallback };
