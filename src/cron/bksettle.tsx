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

  cron.schedule(
    '* * * *',
    async () => {
      // (1) ambil semua order PAID
      const pendingOrders = await prisma.order.findMany({
        where: {
          status: 'PAID',
          partnerClientId: { not: null }
        },
        select: {
          id: true,
          partnerClientId: true,
          pendingAmount: true,
          channel: true
        }
      })
      if (pendingOrders.length === 0) return

      // (2) ambil semua credential sub_merchant yang diperlukan
      const clientIds = Array.from(new Set(pendingOrders.map(o => o.partnerClientId!)))
      const subMerchants = await prisma.sub_merchant.findMany({
        where: {
          merchantId: { in: clientIds }
        },
        select: {
          merchantId: true,
          provider: true,
          credentials: true
        }
      })
      // bangun map: key = `${merchantId}|${provider}`
      const credMap: Record<string, any> = {}
      subMerchants.forEach(sm => {
        try {
          credMap[`${sm.merchantId}|${sm.provider.toLowerCase()}`] = JSON.parse(sm.credentials)
        } catch {
          // jika JSON invalid, skip
        }
      })

      // (3) Proses setiap order sesuai channel-nya
      await Promise.all(pendingOrders.map(async o => {
        const key = `${o.partnerClientId}|${o.channel.toLowerCase()}`
        const cred = credMap[key]
        if (!cred) {
          // tidak ada credentials di DB, skip
          return
        }

        if (o.channel.toLowerCase() === 'hilogate') {
          // Hilogate flow
          try {
            const path = `/api/v1/transactions/${o.id}`
            const sig = generateSignature(path, cred.secretKey)
            const resp = await axios.get(
              `${cred.baseUrl || config.api.hilogate.baseUrl}${path}`,
              {
                headers: {
                  'Content-Type': 'application/json',
                  'X-Merchant-ID': cred.merchantId,
                  'X-Signature': sig
                },
                timeout: 5_000
              }
            )
            const tx = resp.data.data
            const settleSt = (tx.settlement_status ?? '').toUpperCase()
            if (['ACTIVE', 'SETTLED', 'COMPLETED'].includes(settleSt)) {
              const netAmt = o.pendingAmount ?? tx.net_amount
              const settlementTime = tx.updated_at ? new Date(tx.updated_at) : undefined
              // update order
              await prisma.order.update({
                where: { id: o.id },
                data: {
                  status: 'SETTLED',
                  settlementAmount: netAmt,
                  pendingAmount: null,
                  rrn: tx.rrn ?? 'N/A',
                  settlementTime,
                  updatedAt: new Date()
                }
              })
              // update balance
              await prisma.partnerClient.update({
                where: { id: o.partnerClientId! },
                data: { balance: { increment: netAmt } }
              })
            }
          } catch {
            // silenced
          }
        }

        if (o.channel.toLowerCase() === 'oy') {
          // OY QRIS flow
          try {
            const headers = {
              'Content-Type': 'application/json',
              'x-oy-username': cred.username,
              'x-api-key': cred.apiKey
            }
            // step 1: check status
            const statusResp = await axios.post(
              'https://partner.oyindonesia.com/api/payment-routing/check-status',
              { partner_trx_id: o.id, send_callback: false },
              { headers, timeout: 5_000 }
            )
            const s = statusResp.data
            const code = s.status?.code
            const settleSt = (s.settlement_status ?? '').toUpperCase()
            if (code !== '000' || settleSt === 'WAITING') return

            // step 2: ambil detail transaksi
            const detailResp = await axios.get(
              'https://partner.oyindonesia.com/api/v1/transaction',
              {
                params: { partner_tx_id: o.id, product_type: 'PAYMENT_ROUTING' },
                headers,
                timeout: 5_000
              }
            )
            const ds = detailResp.data.status
            if (ds?.code !== '000') return
            const d = detailResp.data.data
            if (!d) return

            const netAmt = d.settlement_amount
            const fee = d.admin_fee.total_fee
            const settlementTime = d.settlement_time ? new Date(d.settlement_time) : undefined

            // update order & partner balance
            const upd = await prisma.order.updateMany({
              where: { id: o.id, status: 'PAID' },
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
        }

        // bisa ditambah else-if untuk provider lain...
      }))
    },
    { timezone: 'Asia/Jakarta' }
  )
}
