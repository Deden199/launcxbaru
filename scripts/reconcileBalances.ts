import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient, DisbursementStatus } from '@prisma/client';

const prisma = new PrismaClient();

interface BalanceSummary {
  clientId: string;
  oldBalance: number;
  totalSettlement: number;
  totalWithdraw: number;
  newBalance: number;
}

async function reconcileBalances(): Promise<void> {
  const clients = await prisma.partnerClient.findMany();
  const summaries: BalanceSummary[] = [];

  for (const client of clients) {
    const settlementAgg = await prisma.order.aggregate({
      _sum: { settlementAmount: true },
      where: { partnerClientId: client.id, settlementTime: { not: null } },
    });
    const totalSettlement = settlementAgg._sum.settlementAmount ?? 0;

    const withdrawAgg = await prisma.withdrawRequest.aggregate({
      _sum: { amount: true },
      where: {
        partnerClientId: client.id,
        status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] },
      },
    });
    const totalWithdraw = withdrawAgg._sum.amount ?? 0;

    const newBalance = totalSettlement - totalWithdraw;

    await prisma.partnerClient.update({
      where: { id: client.id },
      data: { balance: newBalance },
    });

    summaries.push({
      clientId: client.id,
      oldBalance: client.balance,
      totalSettlement,
      totalWithdraw,
      newBalance,
    });
  }

  console.table(summaries);
}

reconcileBalances()
  .catch((err) => {
    console.error('Error reconciling balances:', err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
