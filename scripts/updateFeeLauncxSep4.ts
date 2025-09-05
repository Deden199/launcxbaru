import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { computeSettlement } from '../src/service/feeSettlement';

dotenv.config();
const prisma = new PrismaClient();
const FEE_PERCENT = 1.25; // 1.25%

async function updateFees() {
  const tz = 'Asia/Jakarta';

  // Batas waktu untuk tanggal 4 Sep 2025 (WIB)
  const start = fromZonedTime('2025-09-04T00:00:00', tz);
  const end   = fromZonedTime('2025-09-05T00:00:00', tz);

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { paymentReceivedTime: { gte: start, lt: end } },
        {
          paymentReceivedTime: null,
          createdAt: { gte: start, lt: end }
        }
      ]
    },
    select: {
      id: true,
      amount: true,
      fee3rdParty: true,
      pendingAmount: true,
      settlementAmount: true
    }
  });

  for (const o of orders) {
    const { fee, settlement } = computeSettlement(o.amount, { percent: FEE_PERCENT });
    const data: any = { feeLauncx: fee };

    if (o.settlementAmount != null) {
      const netAfterPg = settlement - (o.fee3rdParty ?? 0);
      data.settlementAmount = netAfterPg;
    } else {
      data.pendingAmount = settlement;
    }

    await prisma.order.update({ where: { id: o.id }, data });
  }

  console.log(`Updated ${orders.length} orders with ${FEE_PERCENT}% fee.`);
}

updateFees()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
