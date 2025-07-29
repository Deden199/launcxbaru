import cron from 'node-cron'
import moment from 'moment-timezone'
import { prisma } from '../core/prisma'
import { config } from '../config'
import { sendTelegramMessage } from '../core/telegram.axios'
import { DisbursementStatus } from '@prisma/client'
import { formatDateJakarta } from '../util/time'

async function buildSummaryMessage(): Promise<string> {
  const nowJakarta = moment().tz('Asia/Jakarta')
  const startOfDay = nowJakarta.clone().startOf('day').toDate()
  const now        = nowJakarta.toDate()

  const successStatuses = ['PAID', 'DONE', 'SETTLED', 'SUCCESS'] as const

  const tpvAgg = await prisma.order.aggregate({
    _sum: { amount: true },
    where: { createdAt: { gte: startOfDay, lte: now }, status: { in: successStatuses as any } }
  })

  const settleAgg = await prisma.order.aggregate({
    _sum: { settlementAmount: true },
    where: {
      createdAt: { gte: startOfDay, lte: now },
      status: { in: ['SUCCESS', 'DONE', 'SETTLED'] }
    }
  })

  const paidAgg = await prisma.order.aggregate({
    _sum: { amount: true },
    where: { createdAt: { gte: startOfDay, lte: now }, status: 'PAID' }
  })

  const wdAgg = await prisma.withdrawRequest.aggregate({
    _sum: { amount: true },
    where: {
      createdAt: { gte: startOfDay, lte: now },
      status: DisbursementStatus.COMPLETED
    }
  })

  const msgLines = [
    `[Dashboard Summary] ${formatDateJakarta(now)}`,
    `Total Payment Volume : ${tpvAgg._sum.amount ?? 0}`,
    `Total Paid           : ${paidAgg._sum.amount ?? 0}`,
    `Total Settlement     : ${settleAgg._sum.settlementAmount ?? 0}`,
    `Successful Withdraw  : ${wdAgg._sum.amount ?? 0}`
  ]
  return msgLines.join('\n')
}

async function sendSummary() {
  try {
    const message = await buildSummaryMessage()
    const chatId = config.api.telegram.adminChannel
    if (chatId) {
      await sendTelegramMessage(chatId, message)
    }
  } catch (err) {
    console.error('[dashboardSummary]', err)
  }
}

export function scheduleDashboardSummary() {
  const opts = { timezone: 'Asia/Jakarta' as const }
  // Kirim summary tepat di menit ke-0 setiap jam
  cron.schedule('0 * * * *', sendSummary, opts)
}
