// File: src/controllers/bank.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { isJakartaWeekend } from '../util/time'

export async function getBanks(req: Request, res: Response) {
  try {
    // 1) Cari internal merchant Hilogate
    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' }
    });
    if (!merchant) {
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' });
    }

    const isWeekend = isJakartaWeekend(new Date());
    const allSubs = await prisma.sub_merchant.findMany({
      where: {
        merchantId: merchant.id,
        provider: 'hilogate',
      }
    });
    const subs = allSubs.filter(s => s.schedule[isWeekend ? 'weekend' : 'weekday']);
    if (subs.length === 0) {
      return res.status(500).json({ error: 'No active Hilogate credentials today' });
    }

    // 3) Parse kredensial
    const rawCreds = subs[0].credentials;
    let cfg: HilogateConfig;
    if (typeof rawCreds === 'string') {
      try {
        cfg = JSON.parse(rawCreds);
      } catch {
        return res.status(500).json({ error: 'Invalid credentials format' });
      }
    } else {
      cfg = rawCreds as unknown as HilogateConfig;
    }

    // 4) Panggil API untuk daftar bank
    const client = new HilogateClient(cfg);
    let banks;
    try {
      banks = await client.getBankCodes();
    } catch {
      return res.status(500).json({ error: 'Error fetching bank list from Hilogate' });
    }

    // 5) Kembalikan hasil
    return res.json({ banks });

  } catch {
    return res
      .status(500)
      .json({ error: 'Gagal mengambil daftar bank dari Hilogate' });
  }
}
