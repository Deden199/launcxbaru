// File: src/controllers/bank.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';

export async function getBanks(req: Request, res: Response) {
  console.log('=== [getBanks] START ===');
  try {
    // 1) Cari internal merchant Hilogate
    console.log('[getBanks] Step 1: mencari merchant hilogate');
    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' }
    });
    console.log('[getBanks] merchant result:', merchant);
    if (!merchant) {
      console.error('[getBanks] Error: Internal Hilogate merchant not found');
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' });
    }

    // 2) Ambil kredensial sub-merchant yang aktif hari ini
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;
    console.log(`[getBanks] Step 2: hari ini day=${day} (${isWeekend ? 'weekend' : 'weekday'})`);
    console.log('[getBanks] Step 2: mencari semua sub_merchant dengan provider hilogate');
    const allSubs = await prisma.sub_merchant.findMany({
      where: {
        merchantId: merchant.id,
        provider: 'hilogate',
      }
    });
    console.log('[getBanks] all sub_merchants:', allSubs);

    console.log(`[getBanks] Step 2: filter schedule.${isWeekend ? 'weekend' : 'weekday'} = true`);
    const subs = allSubs.filter(s => s.schedule[isWeekend ? 'weekend' : 'weekday']);
    console.log('[getBanks] active sub_merchants today:', subs);
    if (!subs.length) {
      console.error('[getBanks] Error: No active Hilogate credentials today');
      return res.status(500).json({ error: 'No active Hilogate credentials today' });
    }

    // 3) Instansiasi HilogateClient dengan kredensial dari DB
    console.log('[getBanks] Step 3: parsing credentials');
    const rawCreds = subs[0].credentials;
    console.log('[getBanks] rawCreds:', rawCreds);
    let cfg: HilogateConfig;
    if (typeof rawCreds === 'string') {
      try {
        cfg = JSON.parse(rawCreds);
      } catch (parseErr) {
        console.error('[getBanks] Error parsing credentials JSON:', parseErr);
        return res.status(500).json({ error: 'Invalid credentials format' });
      }
    } else {
  cfg = rawCreds as unknown as HilogateConfig;
    }
    console.log('[getBanks] config for client:', cfg);

    const client = new HilogateClient(cfg);
    console.log('[getBanks] HilogateClient instantiated');

    // 4) Panggil API untuk daftar bank
    console.log('[getBanks] Step 4: calling client.getBankCodes()');
    let banks;
    try {
      banks = await client.getBankCodes();
      console.log('[getBanks] banks response:', banks);
    } catch (apiErr) {
      console.error('[getBanks] Error from getBankCodes():', apiErr);
      return res.status(500).json({ error: 'Error fetching bank list from Hilogate' });
    }

    // 5) Kembalikan hasil
    console.log('[getBanks] Step 5: returning response');
    console.log('=== [getBanks] END ===');
    return res.json({ banks });

  } catch (err: any) {
    console.error('[getBanks] Unhandled error:', err);
    return res
      .status(500)
      .json({ error: 'Gagal mengambil daftar bank dari Hilogate' });
  }
}
