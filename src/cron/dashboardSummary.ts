import cron from 'node-cron'
import moment from 'moment-timezone'
import { prisma } from '../core/prisma'
import { config } from '../config'
import { DisbursementStatus } from '@prisma/client'
import { formatDateJakarta } from '../util/time'
import { formatIdr } from '../util/currency'
import axios from 'axios'

async function buildSummaryMessage(): Promise<string> {
  const nowJakarta  = moment().tz('Asia/Jakarta')
  const startOfDay  = nowJakarta.clone().startOf('day').toDate()
  const startOfMonth = nowJakarta.clone().startOf('month').toDate()
  const now         = nowJakarta.toDate()

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

  const pendingAgg = await prisma.order.aggregate({
    _sum: { pendingAmount: true },
    where: {
      createdAt: { gte: startOfMonth, lt: startOfDay },
      status: 'PAID'
    }
  })

  const wdAgg = await prisma.withdrawRequest.aggregate({
    _sum: { amount: true },
    where: {
      createdAt: { gte: startOfDay, lte: now },
      status: DisbursementStatus.COMPLETED
    }
  })
  const inAgg = await prisma.order.aggregate({
    _sum: { settlementAmount: true },
    where: { settlementTime: { not: null } }
  })

  const outAgg = await prisma.withdrawRequest.aggregate({
    _sum: { amount: true },
    where: { status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] } }
  })

  const totalClientBalance =
    (inAgg._sum.settlementAmount ?? 0) - (outAgg._sum.amount ?? 0)

  const msgLines = [
    `[Dashboard Summary] ${formatDateJakarta(now)}`,
    `Total Payment Volume : ${formatIdr(tpvAgg._sum.amount ?? 0)}`,
    `Total Paid           : ${formatIdr(paidAgg._sum.amount ?? 0)}`,
    `Total Settlement     : ${formatIdr(settleAgg._sum.settlementAmount ?? 0)}`,
    `Pending Settlement (Month to Yesterday) : ${formatIdr(pendingAgg._sum.pendingAmount ?? 0)}`,
    `Successful Withdraw  : ${formatIdr(wdAgg._sum.amount ?? 0)}`,
    `Available Client Withdraw : ${formatIdr(totalClientBalance)}`
  ]
  // Bungkus dengan triple backticks:
  return ['```', ...msgLines, '```'].join('\n')
}

async function sendSummary() {
  try {
    const message = await buildSummaryMessage()
    const chatId = config.api.telegram.adminChannel
    if (chatId) {
      await axios.post(
        `https://api.telegram.org/bot${config.api.telegram.botToken}/sendMessage`,
        {
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown'
        }
      )
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
