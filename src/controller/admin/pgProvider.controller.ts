import { Request, Response } from 'express';
import { config }           from '../../config';

// GET /api/v1/admin/pg-providers
export const listProviders = (_req: Request, res: Response) => {
  const list = [] as { id: string; name: string; credentials: { partnerId: string } }[];

  if (config.api.hilogate.merchantId) {
    list.push({
      id: 'hilogate',
      name: 'Hilogate',
      credentials: { partnerId: config.api.hilogate.merchantId },
    });
  }
  if (config.api.tcpp.merchantId) {
    list.push({
      id: '2c2p',
      name: '2C2P',
      credentials: { partnerId: config.api.tcpp.merchantId },
    });
  }
  if (config.api.oy.username) {
    list.push({
      id: 'oy',
      name: 'OY Indonesia',
      credentials: { partnerId: config.api.oy.username },
    });
  }

  res.json(list);
};
