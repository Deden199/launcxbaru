import cron from 'node-cron'
import moment from 'moment-timezone'
import { prisma } from '../core/prisma'
import { config } from '../config'
import { formatDateJakarta } from '../util/time'
import { formatIdr } from '../util/currency'
import axios from 'axios'
import { getParentClientsWithChildren } from '../service/partnerClient'

const DisbursementStatus = {
  COMPLETED: 'COMPLETED',
  PENDING: 'PENDING'
} as const

export async function buildSummaryMessage(): Promise<string[]> {
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
  const globalMsg = ['```', ...msgLines, '```'].join('\n')

  const groups = await getParentClientsWithChildren()
  const groupMessages: string[] = []

  for (const parent of groups) {
    if (parent.children.length === 0) continue
    const ids = [parent.id, ...parent.children.map(c => c.id)]

    const gTpvAgg = await prisma.order.aggregate({
      _sum: { amount: true },
      where: {
        createdAt: { gte: startOfDay, lte: now },
        status: { in: successStatuses as any },
        partnerClientId: { in: ids }
      }
    })

    const gSettleAgg = await prisma.order.aggregate({
      _sum: { settlementAmount: true },
      where: {
        createdAt: { gte: startOfDay, lte: now },
        status: { in: ['SUCCESS', 'DONE', 'SETTLED'] },
        partnerClientId: { in: ids }
      }
    })

    const gPaidAgg = await prisma.order.aggregate({
      _sum: { amount: true },
      where: {
        createdAt: { gte: startOfDay, lte: now },
        status: 'PAID',
        partnerClientId: { in: ids }
      }
    })

    const gPendingAgg = await prisma.order.aggregate({
      _sum: { pendingAmount: true },
      where: {
        createdAt: { gte: startOfMonth, lt: startOfDay },
        status: 'PAID',
        partnerClientId: { in: ids }
      }
    })

    const gWdAgg = await prisma.withdrawRequest.aggregate({
      _sum: { amount: true },
      where: {
        createdAt: { gte: startOfDay, lte: now },
        status: DisbursementStatus.COMPLETED,
        partnerClientId: { in: ids }
      }
    })

    const gInAgg = await prisma.order.aggregate({
      _sum: { settlementAmount: true },
      where: { settlementTime: { not: null }, partnerClientId: { in: ids } }
    })

    const gOutAgg = await prisma.withdrawRequest.aggregate({
      _sum: { amount: true },
      where: {
        status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] },
        partnerClientId: { in: ids }
      }
    })

    const gTotalClientBalance =
      (gInAgg._sum.settlementAmount ?? 0) - (gOutAgg._sum.amount ?? 0)

    const groupLines = [
      `[Dashboard Summary - ${parent.name}] ${formatDateJakarta(now)}`,
      `Total Payment Volume : ${formatIdr(gTpvAgg._sum.amount ?? 0)}`,
      `Total Paid           : ${formatIdr(gPaidAgg._sum.amount ?? 0)}`,
      `Total Settlement     : ${formatIdr(gSettleAgg._sum.settlementAmount ?? 0)}`,
      `Pending Settlement (Month to Yesterday) : ${formatIdr(gPendingAgg._sum.pendingAmount ?? 0)}`,
      `Successful Withdraw  : ${formatIdr(gWdAgg._sum.amount ?? 0)}`,
      `Available Client Withdraw : ${formatIdr(gTotalClientBalance)}`
    ]

    groupMessages.push(['```', ...groupLines, '```'].join('\n'))
  }

  return [globalMsg, ...groupMessages]
}

async function sendSummary() {
  try {
    const messages = await buildSummaryMessage()
    const chatId = config.api.telegram.adminChannel
    if (chatId) {
      for (const msg of messages) {
        if (msg.length <= 4096) {
          await axios.post(
            `https://api.telegram.org/bot${config.api.telegram.botToken}/sendMessage`,
            {
              chat_id: chatId,
              text: msg,
              parse_mode: 'Markdown'
            }
          )
        } else {
          for (let i = 0; i < msg.length; i += 4096) {
            const chunk = msg.slice(i, i + 4096)
            await axios.post(
              `https://api.telegram.org/bot${config.api.telegram.botToken}/sendMessage`,
              {
                chat_id: chatId,
                text: chunk,
                parse_mode: 'Markdown'
              }
            )
          }
        }
      }
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
