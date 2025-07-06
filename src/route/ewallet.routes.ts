import { Router } from 'express';
import { createEwallet, callbackEwallet } from '../controller/ewallet.controller';
import { EwalletService } from '../service/ewallet.service';

const router = Router();
const svc = new EwalletService();

router.post('/ewallet/transaction', createEwallet);

router.post('/ewallet/check-status', async (req, res) => {
  try {
    const { partnerTrxId } = req.body;
    if (!partnerTrxId) {
      return res.status(400).json({ error: 'partnerTrxId is required' });
    }
    const data = await svc.checkStatus(partnerTrxId);
    return res.json(data);
  } catch (err: any) {
    console.error('checkStatus error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/ewallet/callback', callbackEwallet);

export default router;
