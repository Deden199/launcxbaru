import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Result {
    merchantId: string;
    merchantName: string;
    totalSettlementAmount: number;
    totalDisbursedAmount: number;
    settledBalance: number;
}

async function calculateDifferences(): Promise<void> {
    try {
        // Step 1: Get total settlement amounts and merchant names per merchant
        const settlementTotals = await prisma.transaction_request.groupBy({
            by: ['merchantId'],
            where: { status: 'SETTLEMENT' },
            _sum: { settlementAmount: true },
        });

        // Fetch merchant names separately
        const merchantNames = await prisma.merchant.findMany({
            select: { id: true, name: true }
        });

        // Step 2: Get total disbursed amounts per merchant, filtering by multiple statuses
        const disbursedTotals = await prisma.disbursement.groupBy({
            by: ['merchantId'],
            where: { status: { in: ['COMPLETED', 'PENDING', 'CREATED'] } },
            _sum: { totalAmount: true },
        });

        // Step 3: Convert disbursedTotals and merchantNames to dictionaries for quick lookup
        const disbursedMap: { [merchantId: string]: number } = {};
        disbursedTotals.forEach(disbursement => {
            disbursedMap[disbursement.merchantId] = Number(disbursement._sum.totalAmount) || 0;
        });

        const merchantNameMap: { [merchantId: string]: string } = {};
        merchantNames.forEach(merchant => {
            merchantNameMap[merchant.id] = merchant.name;
        });

        // Step 4: Calculate the settled balance for each merchant
        const result: Result[] = settlementTotals.map(settlement => {
            const merchantId = settlement.merchantId;
            const totalSettlementAmount = Number(settlement._sum.settlementAmount) || 0;
            const totalDisbursedAmount = disbursedMap[merchantId] || 0;
            const settledBalance = totalSettlementAmount - totalDisbursedAmount;
            const merchantName = merchantNameMap[merchantId] || "Unknown";

            return {
                merchantId,
                merchantName,
                totalSettlementAmount,
                totalDisbursedAmount,
                settledBalance,
            };
        });

        console.log(result);

        // Calculate the total settled balance
        const totalSettledBalance = result.reduce((sum, item) => sum + item.settledBalance, 0);

        // Calculate the total settled balance excluding the test account
        const totalSettledBalanceExcludingTest = result
            .filter(item => item.merchantId !== "66e8f454c7350f4f250040f0")
            .reduce((sum, item) => sum + item.settledBalance, 0);

        console.log("Total Settled Balance:", totalSettledBalance);
        console.log("Total Settled Balance Excluding Test Account:", totalSettledBalanceExcludingTest);

    } catch (error) {
        console.error("Error calculating differences:", error);
    } finally {
        await prisma.$disconnect();
    }
}

calculateDifferences();
