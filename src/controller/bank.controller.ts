// File: src/controllers/bank.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { getActiveProviders } from '../service/provider';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';

export async function getBanks(req: Request, res: Response) {
  try {
    // 1) Cari internal merchant Hilogate
    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' }
    });
    if (!merchant) {
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' });
    }

    // 2) Ambil kredensial sub-merchant yang aktif hari ini
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;
    const subs = await prisma.sub_merchant.findMany({
      where: {
        merchantId: merchant.id,
        provider:   'hilogate',
        schedule: {
          equals: isWeekend
            ? { weekend: true }
            : { weekday: true }
        }
      }
    });
    if (!subs.length) {
      return res.status(500).json({ error: 'No active Hilogate credentials today' });
    }

    // 3) Instansiasi HilogateClient dengan kredensial dari DB
 const cfg = subs[0].credentials as unknown as HilogateConfig;
    const client = new HilogateClient(cfg);

    // 4) Panggil API untuk daftar bank
    const banks = await client.getBankCodes();

    // 5) Kembalikan hasil
    return res.json({ banks });
  } catch (err: any) {
    console.error('[getBanks] Hilogate API error:', err);
    return res
      .status(500)
      .json({ error: 'Gagal mengambil daftar bank dari Hilogate' });
  }
}
