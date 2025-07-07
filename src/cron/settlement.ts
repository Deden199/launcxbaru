import cron from 'node-cron'
import axios from 'axios'
import { prisma } from '../core/prisma'
import { config } from '../config'
import crypto from 'crypto'

function generateSignature(path: string, secretKey: string): string {
  return crypto
    .createHash('md5')
    .update(path + secretKey, 'utf8')
    .digest('hex')
}

let cronStarted = false
export function scheduleSettlementChecker() {
  if (cronStarted) return
  cronStarted = true

  // Jadwal setiap hari jam 17:00 Asia/Jakarta
  cron.schedule(
    '0 17 * * *',
    async () => {
      // (1) Ambil semua order PENDING_SETTLEMENT
      const pendingOrders = await prisma.order.findMany({
        where: { status: 'PENDING_SETTLEMENT', partnerClientId: { not: null } },
        select: { id: true, partnerClientId: true, pendingAmount: true, channel: true }
      })

      // (2) Proses Hilogate
      const hilogateOrders = pendingOrders.filter(o => o.channel.toLowerCase() === 'hilogate')
      await Promise.all(hilogateOrders.map(async o => {
        try {
          const path = `/api/v1/transactions/${o.id}`
          const sig  = generateSignature(path, config.api.hilogate.secretKey)
          const resp = await axios.get(
            `${config.api.hilogate.baseUrl}${path}`,
            {
              headers: {
                'Content-Type':  'application/json',
                'X-Merchant-ID': config.api.hilogate.merchantId,
                'X-Signature':   sig
              },
              timeout: 5_000
            }
          )

          const tx       = resp.data.data
          const settleSt = (tx.settlement_status ?? '').toUpperCase()
          if (['ACTIVE','SETTLED','COMPLETED'].includes(settleSt)) {
            const netAmt = o.pendingAmount ?? tx.net_amount
            const settlementTime = tx.updated_at
              ? new Date(tx.updated_at)
              : undefined
            const upd = await prisma.order.update({
              where: { id: o.id, status: 'PENDING_SETTLEMENT', partnerClientId: { not: null } },
              data: {
                status: 'SETTLED',
                settlementAmount: netAmt,
                pendingAmount: null,
                rrn: tx.rrn ?? 'N/A',
                settlementTime,
                updatedAt: new Date()
              }
            })
            await prisma.partnerClient.update({
              where: { id: o.partnerClientId! },
              data: { balance: { increment: netAmt } }
            })
          }
        } catch {
          // silenced
        }
      }))

      // (3) Proses OY QRIS
      const oyOrders = pendingOrders.filter(o => o.channel.toLowerCase() === 'oy')
      await Promise.all(oyOrders.map(async o => {
        try {
          // Check-status
          const statusUrl     = 'https://partner.oyindonesia.com/api/payment-routing/check-status'
          const statusBody    = { partner_trx_id: o.id, send_callback: false }
          const statusHeaders = {
            'Content-Type':  'application/json',
            'x-oy-username': config.api.oy.username,
            'x-api-key':     config.api.oy.apiKey
          }

          const statusResp = await axios.post(statusUrl, statusBody, { headers: statusHeaders, timeout: 5_000 })
          const s          = statusResp.data
          const code       = s.status?.code
          const settleSt   = (s.settlement_status ?? '').toUpperCase()
          if (code !== '000' || settleSt === 'WAITING') return

          // Detail-transaksi
          const detailUrl    = 'https://partner.oyindonesia.com/api/v1/transaction'
          const detailParams = { partner_tx_id: o.id, product_type: 'PAYMENT_ROUTING' }
          const detailResp = await axios.get(detailUrl, {
            params: detailParams,
            headers: statusHeaders,
            timeout: 5_000
          })

          const ds = detailResp.data.status
          if (ds?.code !== '000') return
          const d = detailResp.data.data
          if (!d) return

          const netAmt = d.settlement_amount
          const fee    = d.admin_fee.total_fee

          const settlementTime = d.settlement_time
            ? new Date(d.settlement_time)
            : undefined

          const upd = await prisma.order.updateMany({
            where: { id: o.id, status: 'PENDING_SETTLEMENT', partnerClientId: { not: null } },
            data: {
              status: 'SETTLED',
              settlementAmount: netAmt,
              pendingAmount: null,
              fee3rdParty: fee,
              rrn: s.trx_id,
              updatedAt: new Date(),
              settlementTime
            }
          })
          if (upd.count > 0) {
            await prisma.partnerClient.update({
              where: { id: o.partnerClientId! },
              data: { balance: { increment: netAmt } }
            })
          }
        } catch {
          // silenced
        }
      }))
    },
    { timezone: 'Asia/Jakarta' }
  )
}
