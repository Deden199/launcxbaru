// File: src/controllers/bank.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { OyClient, OyConfig } from '../service/oyClient';
import { getActiveProviders } from '../service/provider';
import type { ResultSub } from '../service/provider';
export async function getBanks(req: Request, res: Response) {
  const provider = (req.query.provider as string)?.toLowerCase() || 'hilogate';


  try {
    // 1) Cari internal merchant Hilogate
    const merchant = await prisma.merchant.findFirst({ where: { name: provider } });

    if (!merchant) {
      return res.status(500).json({ error: `Internal ${provider} merchant not found` });
    }

    if (provider === 'hilogate') {
      const subs = (await getActiveProviders(
        merchant.id,
        'hilogate'
      )) as ResultSub<HilogateConfig>[];
      if (!subs.length) {
        return res.status(500).json({ error: 'No active Hilogate credentials today' });
      }
        const cfg = subs[0].config as HilogateConfig;
      const client = new HilogateClient(cfg);
      let banks;
      try {
        banks = await client.getBankCodes();
      } catch {
        return res.status(500).json({ error: 'Error fetching bank list from Hilogate' });
      }
      return res.json({ banks });

    }

    if (provider === 'oy') {
      const subs = (await getActiveProviders(
        merchant.id,
        'oy'
      )) as ResultSub<OyConfig>[];
      if (!subs.length) {
        return res.status(500).json({ error: 'No active OY credentials today' });
      }
      const cfg = subs[0].config as OyConfig;
      const client = new OyClient(cfg);
      let banks;
      try {
        banks = await client.getBankList();
      } catch {
        return res.status(500).json({ error: 'Error fetching bank list from OY' });
      }
      return res.json({ banks });
    }

    // 5) Kembalikan hasil
    return res.status(400).json({ error: 'Unsupported provider' });

  } catch {
      return res.status(500).json({ error: 'Gagal mengambil daftar bank' });

  }
}
