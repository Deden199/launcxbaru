import { Request, Response, NextFunction } from 'express';
import { prisma } from '../core/prisma';

let whitelist: string[] | null = null;

async function fetchWhitelist() {
  const row = await prisma.setting.findUnique({
    where: { key: 'admin_ip_whitelist' },
  });
  whitelist = row?.value
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean) ?? [];
}

export async function refreshAdminIpWhitelist() {
  await fetchWhitelist();
}

export async function adminIpWhitelist(req: Request, res: Response, next: NextFunction) {
  if (whitelist === null) {
    await fetchWhitelist();
  }
  const header = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const ip = header.split(',')[0].trim();
  if ((whitelist?.length ?? 0) > 0 && !whitelist!.includes(ip)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}


