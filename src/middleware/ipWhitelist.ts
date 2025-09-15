import { Request, Response, NextFunction } from 'express';
import { prisma } from '../core/prisma';

let adminWhitelist: string[] | null = null;
let s2sWhitelist: string[] | null = null;

async function fetchWhitelist(key: string): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return (
    row?.value
      .split(',')
      .map(ip => ip.trim())
      .filter(Boolean) ?? []
  );
}

export async function refreshAdminIpWhitelist() {
  adminWhitelist = await fetchWhitelist('admin_ip_whitelist');
}

export async function refreshS2SIpWhitelist() {
  s2sWhitelist = await fetchWhitelist('s2s_ip_whitelist');
}

export async function adminIpWhitelist(req: Request, res: Response, next: NextFunction) {
  if (adminWhitelist === null) {
    await refreshAdminIpWhitelist();
  }
  const header = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const ip = header.split(',')[0].trim();
  if ((adminWhitelist?.length ?? 0) > 0 && !adminWhitelist!.includes(ip)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

export async function s2sIpWhitelist(req: Request, res: Response, next: NextFunction) {
  if (s2sWhitelist === null) {
    await refreshS2SIpWhitelist();
  }
  const header = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const ip = header.split(',')[0].trim();
  if ((s2sWhitelist?.length ?? 0) > 0 && !s2sWhitelist!.includes(ip)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}


