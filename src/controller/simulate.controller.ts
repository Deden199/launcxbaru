import { Request, Response } from 'express';
import { processHilogatePayload } from '../service/payment';

export const simulateCallback = async (req: Request, res: Response) => {
  try {
    const { orderId, amount, method = 'qris' } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ success:false, error:'orderId & amount wajib' });
    }
    // panggil core processing
    await processHilogatePayload({
      ref_id:            orderId,
      amount,
      method,
      status:            'SUCCESS',
      net_amount:        amount,
      settlement_status: 'PENDING'
    });
    return res.status(200).json({ success:true, message:'Simulasi callback berhasil' });
  } catch (err:any) {
    return res.status(500).json({ success:false, error:err.message });
  }
};
