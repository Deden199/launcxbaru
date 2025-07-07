import cron from 'node-cron'
import axios from 'axios'
import { prisma } from '../core/prisma'
import { config } from '../config'
import logger from '../logger'
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

  // Testing: run every minute
  cron.schedule(
    '* * * * *',
    async () => {
      logger.info('[SettlementCron] Mulai cek settlement…')

      // (1) Grab semua order PENDING_SETTLEMENT
      const pendingOrders = await prisma.order.findMany({
        where: { status: 'PENDING_SETTLEMENT', partnerClientId: { not: null } },
        select: { id: true,    partnerClientId: true,   pendingAmount: true, channel: true }
      })

      // (2) Hilogate flow
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
          const rrn      = tx.rrn ?? 'N/A'
          logger.info(`[SettlementCron][HILOGATE] ${o.id} status=${settleSt}, rrn=${rrn}`)

          if (['ACTIVE', 'SETTLED', 'COMPLETED'].includes(settleSt)) {
            const netAmt = o.pendingAmount ?? tx.net_amount
            const updateResult = await prisma.order.updateMany({
              where: { id: o.id, status: 'PENDING_SETTLEMENT',    partnerClientId: { not: null }      // ← pakai partnerClientId, bukan merchantId
 },
              data: {
                status:           'SETTLED',
                settlementAmount: netAmt,
                pendingAmount:    null,
                rrn,
                updatedAt:        new Date()
              }
            })
            if (updateResult.count > 0) {
              await prisma.partnerClient.update({
                where: { id: o.partnerClientId! },
                data: { balance: { increment: netAmt } }
              })
              logger.info(`[SettlementCron][HILOGATE] ${o.id} settled +${netAmt}`)
            }
          }
        } catch (err: any) {
          const errData = err.response?.data
            ? JSON.stringify(err.response.data)
            : err.message
          logger.error(`[SettlementCron][HILOGATE] Gagal cek ${o.id}: ${errData}`)
        }
      }))

      // (3) OY QRIS flow
      const oyOrders = pendingOrders.filter(o => o.channel.toLowerCase() === 'oy')
      await Promise.all(oyOrders.map(async o => {
        try {
          // 3a) Check-status
          const statusUrl     = 'https://partner.oyindonesia.com/api/payment-routing/check-status'
          const statusBody    = { partner_trx_id: o.id, send_callback: false }
          const statusHeaders = {
            'Content-Type':  'application/json',
            'x-oy-username': config.api.oy.username,
            'x-api-key':     config.api.oy.apiKey
          }

          logger.info(
            `[SettlementCron][OY][REQUEST] POST ${statusUrl} ` +
            `headers=${JSON.stringify(statusHeaders)} ` +
            `body=${JSON.stringify(statusBody)}`
          )

          const statusResp = await axios.post(statusUrl, statusBody, { headers: statusHeaders, timeout: 5_000 })
          const s          = statusResp.data
          const code       = s.status?.code
          const settleSt   = (s.settlement_status ?? '').toUpperCase()

          if (code !== '000') {
            logger.warn(`[SettlementCron][OY] ${o.id} not ready: ${code} ${s.status.message}`)
            return
          }
          if (settleSt === 'WAITING') {
            logger.info(`[SettlementCron][OY] ${o.id} still pending (WAITING), skip.`)
            return
          }

          // 3b) Detail-transaksi untuk fee
          const detailUrl    = 'https://partner.oyindonesia.com/api/v1/transaction'
          const detailParams = { partner_tx_id: o.id, product_type: 'PAYMENT_ROUTING' }

          logger.info(
            `[SettlementCron][OY][REQUEST] GET ${detailUrl} ` +
            `headers=${JSON.stringify(statusHeaders)} ` +
            `params=${JSON.stringify(detailParams)}`
          )

          const detailResp = await axios.get(detailUrl, {
            params: detailParams,
            headers: statusHeaders,
            timeout: 5_000
          })

          const ds = detailResp.data.status
          if (ds?.code !== '000') {
            logger.warn(`[SettlementCron][OY] Detail API error for ${o.id}: ${ds.code} ${ds.message}`)
            return
          }
          const d = detailResp.data.data
          if (!d) {
            logger.warn(`[SettlementCron][OY] Detail data null for ${o.id}, skip.`)
            return
          }

          const netAmt = d.settlement_amount
          const fee    = d.admin_fee.total_fee
          const rrn    = s.trx_id

          // 3c) Update DB idempoten & kredit
          const updateResult = await prisma.order.updateMany({
            where: { id: o.id, status: 'PENDING_SETTLEMENT',    partnerClientId: { not: null }      // ← pakai partnerClientId, bukan merchantId
 },
            data: {
              status:           'SETTLED',
              settlementAmount: netAmt,
              pendingAmount:    null,
              fee3rdParty:      fee,
              rrn,
              updatedAt:        new Date()
            }
          })
          if (updateResult.count > 0) {
            await prisma.partnerClient.update({
              where: { id: o.partnerClientId! },
              data: { balance: { increment: netAmt } }
            })
            logger.info(`[SettlementCron][OY] ${o.id} settled +${netAmt} (fee=${fee})`)
          }
        } catch (err: any) {
          const errData = err.response?.data
            ? JSON.stringify(err.response.data)
            : err.message
          logger.error(`[SettlementCron][OY] Gagal cek ${o.id}: ${errData}`)
        }
      }))

      logger.info('[SettlementCron] Selesai.')
    },
    { timezone: 'Asia/Jakarta' }
  )
}
