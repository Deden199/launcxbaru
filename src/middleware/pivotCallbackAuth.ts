import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export default function pivotCallbackAuth(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('X-API-Key') || req.header('x-api-key') || '';
  const expected = config.api.pivotCallback.apiKey;

  if (!expected) {
    // Untuk keamanan, tolak kalau server belum dikonfigurasi
    return res.status(500).json({ error: 'Callback API key not configured' });
  }
  if (!incoming || incoming !== expected) {
    return res.status(401).json({ error: 'Unauthorized (invalid X-API-Key)' });
  }
  next();
}
