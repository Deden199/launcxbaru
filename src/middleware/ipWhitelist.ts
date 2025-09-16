import { Request, Response, NextFunction } from 'express';
import { prisma } from '../core/prisma';

let adminWhitelist: string[] | null = null;
let s2sWhitelist: string[] | null = null;
let globalWhitelist: string[] | null = null;

function parseWhitelist(value?: string | null): string[] {
  return (
    value
      ?.split(',')
      .map(ip => ip.trim())
      .filter(Boolean) ?? []
  );
}

async function fetchWhitelist(key: string): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) {
    try {
      await prisma.setting.create({ data: { key, value: '' } });
      return [];
    } catch (error: any) {
      if (error?.code === 'P2002' || error?.code === 11000) {
        const existing = await prisma.setting.findUnique({ where: { key } });
        return parseWhitelist(existing?.value);
      }
      throw error;
    }
  }
  return parseWhitelist(row.value);
}

export async function refreshAdminIpWhitelist() {
  adminWhitelist = await fetchWhitelist('admin_ip_whitelist');
}

export async function refreshS2SIpWhitelist() {
  s2sWhitelist = await fetchWhitelist('s2s_ip_whitelist');
}

export async function refreshGlobalIpWhitelist() {
  globalWhitelist = await fetchWhitelist('global_ip_whitelist');
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

export async function globalIpWhitelist(req: Request, res: Response, next: NextFunction) {
  if (globalWhitelist === null) {
    await refreshGlobalIpWhitelist();
  }
  const header = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const ip = header.split(',')[0].trim();
  if ((globalWhitelist?.length ?? 0) > 0 && !globalWhitelist!.includes(ip)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

