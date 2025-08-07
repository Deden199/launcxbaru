// scripts/sync-from-hilogate.ts
import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../src/config';   // pastikan path sesuai struktur proyek

async function main() {
  const prisma = new PrismaClient();

  // rentang 5–6 Agustus 2025 WIB
  const start = new Date('2025-08-05T00:00:00+07:00');
  const end   = new Date('2025-08-07T00:00:00+07:00');

  // ambil semua order PAID channel HiLogate di rentang itu
  const orders = await prisma.order.findMany({
    where: {
      channel: 'hilogate',
      status: 'PAID',                // hanya status PAID
      createdAt: { gte: start, lt: end },
      partnerClientId: { not: null },
    },
    select: {
      id: true,
      createdAt: true,
      subMerchant: { select: { credentials: true } },
    },
  });

  console.log(`⏳ Menemukan ${orders.length} order HiLogate status PAID untuk di‐sync…`);

  for (const { id, subMerchant } of orders) {
    const creds = subMerchant?.credentials as { merchantId: string; secretKey: string } | undefined;
    if (!creds?.merchantId || !creds?.secretKey) {
      console.warn(`⚠️ Order ${id} tanpa credentials, skip.`);
      continue;
    }

    const path = `/api/v1/transactions/${id}`;
    const sig  = crypto
      .createHash('md5')
      .update(path + creds.secretKey, 'utf8')
      .digest('hex');
    const url  = `${config.api.hilogate.baseUrl}${path}`;

    try {
      const resp = await axios.get(url, {
        headers: {
          'X-Merchant-ID': creds.merchantId,
          'X-Signature': sig,
        },
        timeout: 15_000,
      });

      const tx        = resp.data.data;
      const updatedAt = tx.updated_at ? new Date(tx.updated_at) : null;
      const st        = (tx.settlement_status || '').toUpperCase();

      if (!updatedAt) {
        console.warn(`⚠️ Order ${id}: HiLogate tidak kembali updated_at, skip.`);
        continue;
      }

      await prisma.order.update({
        where: { id },
        data: {
          status:           'SETTLED',
          settlementTime:   updatedAt,
          settlementStatus: st,
          rrn:              tx.rrn ?? undefined,
          settlementAmount: tx.net_amount ?? undefined,
          // tidak mengubah partnerClient.balance
        },
      });

      console.log(`✔ Order ${id} disinkron: ${updatedAt.toISOString()}`);
    } catch (e: any) {
      console.error(`✖ Order ${id} gagal sync:`, e.response?.data || e.message || e);
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
