// scripts/sync-from-hilogate.ts
import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../src/config';

async function main() {
  const prisma = new PrismaClient();

  // rentang 1–19 Agustus 2025 WIB
  const start = new Date('2025-08-01T00:00:00+07:00');
  const end   = new Date('2025-08-20T00:00:00+07:00');

  // ambil semua order PAID channel HiLogate di rentang itu
  const orders = await prisma.order.findMany({
    where: {
      channel: 'hilogate',
      status: 'PAID',
      createdAt: { gte: start, lt: end },
      partnerClientId: { not: null },
    },
    select: {
      id: true,
      createdAt: true,
      partnerClientId: true,
      pendingAmount: true,
      subMerchant: { select: { credentials: true } },
    },
  });

  console.log(`⏳ Menemukan ${orders.length} order HiLogate status PAID untuk di-sync…`);

  const ALLOWED_SETTLEMENT = new Set(['ACTIVE', 'SETTLED', 'COMPLETED', 'SUCCESS']);

  for (const o of orders) {
    const creds = o.subMerchant?.credentials as { merchantId: string; secretKey: string } | undefined;
    if (!creds?.merchantId || !creds?.secretKey) {
      console.warn(`⚠️ Order ${o.id} tanpa credentials, skip.`);
      continue;
    }

    const path = `/api/v1/transactions/${o.id}`;
    const sig  = crypto.createHash('md5').update(path + creds.secretKey, 'utf8').digest('hex');
    const url  = `${config.api.hilogate.baseUrl}${path}`;

    try {
      const resp = await axios.get(url, {
        headers: {
          'X-Merchant-ID': creds.merchantId,
          'X-Signature': sig,
        },
        timeout: 15_000,
      });

      const txData     = resp.data?.data ?? {};
      const updatedAt  = txData.updated_at ? new Date(txData.updated_at) : null;
      const st         = (txData.settlement_status || '').toUpperCase();
      const providerNA = typeof txData.net_amount === 'number' ? txData.net_amount : undefined;

      if (!updatedAt) {
        console.warn(`⚠️ Order ${o.id}: HiLogate tidak mengembalikan updated_at, skip.`);
        continue;
      }
      if (!ALLOWED_SETTLEMENT.has(st)) {
        console.warn(`ℹ️ Order ${o.id}: status provider='${st}' belum settled, skip.`);
        continue;
      }

      const netAmt = (typeof providerNA === 'number' ? providerNA : o.pendingAmount) ?? 0;
      if (netAmt <= 0) {
        console.warn(`⚠️ Order ${o.id}: net amount tidak valid (${netAmt}), skip increment saldo.`);
      }

      // Idempotent: hanya increment saldo jika order MASIH 'PAID'
      await prisma.$transaction(async (ptx) => {
        const upd = await ptx.order.updateMany({
          where: { id: o.id, status: 'PAID' },
          data: {
            status:           'SETTLED',
            settlementTime:   updatedAt,
            settlementStatus: st,
            rrn:              txData.rrn ?? undefined,
            settlementAmount: providerNA ?? undefined, // simpan nilai dari provider kalau ada
            updatedAt:        new Date(),
          },
        });

        if (upd.count > 0 && netAmt > 0) {
          await ptx.partnerClient.update({
            where: { id: o.partnerClientId! },
            data: { balance: { increment: netAmt } },
          });
        }
      });

      console.log(`✔ Order ${o.id} disinkron & ${
        netAmt > 0 ? `saldo +${netAmt}` : 'tanpa perubahan saldo'
      } (${st}) @ ${updatedAt.toISOString()}`);
    } catch (e: any) {
      console.error(`✖ Order ${o.id} gagal sync:`, e?.response?.data || e?.message || e);
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
