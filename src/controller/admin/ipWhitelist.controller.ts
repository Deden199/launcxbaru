import { Response } from 'express';
import { prisma } from '../../core/prisma';
import { AuthRequest } from '../../middleware/auth';
import { refreshAdminIpWhitelist } from '../../middleware/ipWhitelist';
import { logAdminAction } from '../../util/adminLog';

export async function getIpWhitelist(_req: AuthRequest, res: Response) {
  const row = await prisma.setting.findUnique({
    where: { key: 'admin_ip_whitelist' },
  });
  const ips = row?.value
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean) ?? [];
  res.json({ data: ips });
}

export async function updateIpWhitelist(req: AuthRequest, res: Response) {
  const ips: string[] = Array.isArray(req.body.ips)
    ? req.body.ips.map((ip: string) => ip.trim()).filter(Boolean)
    : [];
  const value = ips.join(',');
  await prisma.setting.upsert({
    where: { key: 'admin_ip_whitelist' },
    update: { value },
    create: { key: 'admin_ip_whitelist', value },
  });
  await refreshAdminIpWhitelist();
  if (req.userId) {
    await logAdminAction(req.userId, 'updateIpWhitelist', 'admin_ip_whitelist', ips);
  }
  res.json({ data: ips });
}

