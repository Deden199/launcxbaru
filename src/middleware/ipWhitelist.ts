import { Request, Response, NextFunction } from 'express';

const whitelist = (process.env.ADMIN_IP_WHITELIST || '')
  .split(',')
  .map(ip => ip.trim())
  .filter(Boolean);

export function adminIpWhitelist(req: Request, res: Response, next: NextFunction) {
  const header = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const ip = header.split(',')[0].trim();
  if (whitelist.length > 0 && !whitelist.includes(ip)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

