import axios from 'axios'
import crypto                           from 'crypto'
import { Request, Response }            from 'express'
import { config }                       from '../config'
import logger                           from '../logger'
import { ApiKeyRequest } from '../middleware/apiKeyAuth'
import { getActiveProviders } from '../service/provider'
import { createErrorResponse,
         createSuccessResponse }        from '../util/response'
import paymentService, {
  Transaction,
  OrderRequest,
  OrderResponse,
}                                       from '../service/payment'
import { AuthRequest }                  from '../middleware/auth'
import { prisma }               from '../core/prisma'
import Decimal from 'decimal.js'
import moment                    from 'moment-timezone'
import { postWithRetry }                from '../utils/postWithRetry'

import { isJakartaWeekend } from '../util/time'


export const createTransaction = async (req: ApiKeyRequest, res: Response) => {
  try {
    // 0) Ambil partner-client ID dari apiKeyAuth
    const clientId = req.clientId!
    
    // 1) merchantName default 'hilogate'
    const merchantName = String(req.body.merchantName ?? 'hilogate')
      .trim()
      .toLowerCase()

    // 2) price & playerId
    const price    = Number(req.body.price ?? req.body.amount)
    const playerId = String(req.body.playerId ?? 0)

    // 3) flow
    const flow = req.body.flow === 'redirect' ? 'redirect' : 'embed'

    // 4) validate
    if (isNaN(price) || price <= 0) {
      return res
        .status(400)
        .json(createErrorResponse('`price` harus > 0'))
    }
    const client = await prisma.partnerClient.findUnique({
      where: { id: clientId },
      select: { defaultProvider: true }

    })
    if (!client) {
      return res
        .status(404)
        .json(createErrorResponse('PartnerClient tidak ditemukan'))
    }
    const partnerClientId = clientId
    const defaultProvider = (client.defaultProvider ?? 'hilogate').toLowerCase()
    if (defaultProvider !== 'hilogate' && defaultProvider !== 'oy') {
      return res.status(400).json(createErrorResponse('Invalid defaultProvider'))
    }

        // Fetch internal merchant for the selected provider
    const merchant = await prisma.merchant.findFirst({
      where: { name: defaultProvider },
    })
    if (!merchant) {
      return res
        .status(500)
        .json(createErrorResponse('Internal merchant not found'))
    }

// 2) Ambil kredensial sub‐merchant untuk provider itu
 let subs;
 if (defaultProvider === 'hilogate') {
   subs = await getActiveProviders(merchant.id, 'hilogate');
 } else {
   subs = await getActiveProviders(merchant.id, 'oy');
 }
    if (!subs.length) return res.status(400).json(createErrorResponse('sno'))
    const selectedSubMerchantId = subs[0].id

    // 5) Build Transaction – buyer = partner-client ID
    const trx: Transaction = {
      merchantName,
      price,
      buyer: clientId,
      playerId,
      flow,
      subMerchantId: selectedSubMerchantId,     // ← ambil dari logic kamu
      sourceProvider: defaultProvider.toUpperCase() // atau lowercase sesuai enum
    }

    // 6) Call service
    const result = await paymentService.createTransaction(trx)

    // 7) Respond
    if (flow === 'redirect') {
      return res
        .status(303)
        .location(result.checkoutUrl)
        .send()
    }

    const { orderId, qrPayload, checkoutUrl, totalAmount } = result
    return res
      .status(201)
      .json(
        createSuccessResponse({
          orderId,
          checkoutUrl,
          qrPayload,
          playerId,
          totalAmount,
        })
      )

  } catch (err: any) {
    return res
      .status(500)
      .json(createErrorResponse(err.message ?? 'Internal error'))
  }
}


export const transactionCallback = async (req: Request, res: Response) => {
  let rawBody: string

  try {
    // 1) Baca rawBody & log
    rawBody = (req as any).rawBody.toString('utf8')
    logger.debug('[Callback] rawBody:', rawBody)

    // 2) Verifikasi signature Hilogate (MD5)
    const full = JSON.parse(rawBody) as any
    const minimalPayload = JSON.stringify({
      ref_id: full.ref_id,
      amount: full.amount,
      method: full.method,
    })
        const orderRecord = await prisma.order.findUnique({
      where: { id: full.ref_id },
      select: { subMerchantId: true }
    })
    if (!orderRecord)
      throw new Error(`Order ${full.ref_id} not found`)
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: orderRecord.subMerchantId! },
      select: { credentials: true }
    })
    if (!sub)
      throw new Error(`Sub-merchant ${orderRecord.subMerchantId} not found`)
    const cred = sub.credentials as { secretKey: string }
    const expectedSig = crypto
      .createHash('md5')
      .update(
        '/api/v1/transactions' + minimalPayload + cred.secretKey,
        'utf8'
      )
      .digest('hex')
    const gotSig = req.header('X-Signature') || req.header('x-signature') || ''
    logger.debug(`[Callback] gotSig=${gotSig} expected=${expectedSig}`)
    if (gotSig !== expectedSig) {
      throw new Error('Invalid H signature')
    }
   const paymentReceivedTime = new Date();
  // settlementTime ← full.updated_at (gateway’s completion timestamp)
const settlementTime = full.updated_at?.value
  ? new Date(full.updated_at.value)
  : null;

const trxExpirationTime = full.expires_at?.value
  ? new Date(full.expires_at.value)
  : null;
    // 3) Persist raw callback untuk idempotensi
   const cb = await prisma.transaction_callback.findFirst({
      where: { referenceId: full.ref_id }
    });

    if (cb) {
      await prisma.transaction_callback.update({
        where: { id: cb.id },
        data: {
          updatedAt:             new Date(),
          paymentReceivedTime,
          settlementTime,
          trxExpirationTime,
        }
      });
    } else {
      await prisma.transaction_callback.create({
        data: {
          referenceId:           full.ref_id,
          requestBody:           full,
          paymentReceivedTime,
          settlementTime,
          trxExpirationTime,
        }
      });
    }


    // 4) Extract fields
    const {
      ref_id: orderId,
      status: pgStatus,
      net_amount,
      total_fee: pgFee,
      qr_string,
      settlement_status,
      amount: grossAmount
    } = full
    if (!orderId)         throw new Error('Missing ref_id')
    if (net_amount == null) throw new Error('Missing net_amount')

    // 5) Hitung status internal
    const upStatus  = pgStatus.toUpperCase()
    const isSuccess = ['SUCCESS', 'DONE'].includes(upStatus)
    const newStatus = isSuccess ? 'PAID' : upStatus
    const newSetSt  = settlement_status?.toUpperCase() ?? (isSuccess ? 'PENDING' : null)

    // 6) Ambil merchantId
    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { merchantId: true }
    })
    if (!existing) throw new Error(`Order ${orderId} not found`)
    const merchantId = existing.merchantId

    // 7) Ambil konfigurasi fee partner
    const partnerConfig = await prisma.partnerClient.findUnique({
      where: { id: merchantId },
      select: {
        feePercent:       true,
        feeFlat:          true,
        weekendFeePercent:true,
        weekendFeeFlat:   true,
      }
        })
    if (!partnerConfig) throw new Error(`Partner ${merchantId} not found`)
    const weekend = isJakartaWeekend(paymentReceivedTime)
    const pctFee  = weekend ? partnerConfig.weekendFeePercent ?? 0 : partnerConfig.feePercent ?? 0
    const flatFee = weekend ? partnerConfig.weekendFeeFlat ?? 0 : partnerConfig.feeFlat ?? 0
  // 8) Hitung fee Launcx dengan presisi 3 digit (opsi 1)
const pct       = new Decimal(pctFee)                // misal 1,05 → 1.05
const grossDec  = new Decimal(grossAmount)           // misal 1000
const rawFee    = grossDec.times(pct).dividedBy(100) // 10.5
// round 3 digit; pakai ROUND_HALF_UP (bisa diganti ROUND_FLOOR / ROUND_CEIL)
const feeRounded    = rawFee.toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
const feeLauncxCalc = feeRounded.plus(new Decimal(flatFee))          // + feeFlat

// 9) Simpan status, fee, dan amounts
await prisma.order.update({
  where: { id: orderId },
  data: {
    status: newStatus,   // ← pakai newStatus yang sudah kamu hitung
    settlementStatus: newSetSt,
    qrPayload:        qr_string ?? null,
    updatedAt:        new Date(),
    fee3rdParty:      pgFee,
    feeLauncx:        isSuccess ? feeLauncxCalc.toNumber() : null,
    pendingAmount:    isSuccess
      ? grossDec
          .minus(feeLauncxCalc)
          .toNumber()
      : null,

    settlementAmount: null,
        paymentReceivedTime,
        settlementTime,
        trxExpirationTime,
  }
})

    // 10) Ambil kembali order termasuk feeLauncx & pendingAmount
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        amount:           true,   // gross
        feeLauncx:        true,
        pendingAmount:    true,
        settlementAmount: true
      }
    })
    if (!order) throw new Error(`Order ${orderId} not found after update`)

    // 11) Ambil callbackUrl & secret partner
    const partner = await prisma.partnerClient.findUnique({
      where: { id: merchantId },
      select: { callbackUrl: true, callbackSecret: true }
    })

    // 12) Forward hanya untuk transaksi SUCCESS/DONE
    if (isSuccess && partner?.callbackUrl && partner.callbackSecret) {
      const timestamp = new Date().toISOString()
      const nonce     = crypto.randomUUID()
      const clientPayload = {
        orderId,
        status:           newStatus,
        settlementStatus: newSetSt,
        grossAmount:      order.amount,
        feeLauncx:        order.feeLauncx,
        netAmount:        order.pendingAmount,  // sekarang net
        qrPayload:        qr_string,
        timestamp,
        nonce
      }

      const clientSig = crypto
        .createHmac('sha256', partner.callbackSecret)
        .update(JSON.stringify(clientPayload))
        .digest('hex')

      try {
        await postWithRetry(partner.callbackUrl, clientPayload, {
          headers: { 'X-Callback-Signature': clientSig },
          timeout: 5000,
        })
        logger.info('[Callback] Forwarded SUCCESS transaction')
      } catch (err: any) {
        logger.error('[Callback] Forward to client failed', {
          url: partner.callbackUrl,
          error: err.message,
        })
      }
    }

    // 13) Kirim sukses ke Hilogate
    return res
      .status(200)
      .json(createSuccessResponse({ message: 'OK' }))

  } catch (err: any) {
    logger.error('[Callback] Error processing transaction:', err)
    if (rawBody && !err.message.includes('Invalid H signature')) {
      logger.debug('[Callback] rawBody on error:', rawBody)
    }
    return res
      .status(400)
      .json(createErrorResponse(err.message || 'Unknown error'))
  }
}


export const oyTransactionCallback = async (req: Request, res: Response) => {
  let rawBody = ''
  try {
    // 1) Baca & log raw payload
    rawBody = (req as any).rawBody.toString('utf8')
    logger.debug('[OY Callback] rawBody:', rawBody)

    // 2) Parse payload
    const full = JSON.parse(rawBody) as any
    const orderId       = full.partner_trx_id
    const pgStatusRaw   = (full.payment_status || '').toUpperCase()
const receivedAmt = full.receive_amount
     const settlementSt  = full.settlement_status?.toUpperCase() || null

    if (!orderId) throw new Error('Missing partner_trx_id')
    if (receivedAmt == null) throw new Error('Missing received_amount')

      const paymentReceivedTime = full.payment_received_time
  ? moment
      .tz(full.payment_received_time, 'YYYY-MM-DD HH:mm:ss', 'Asia/Jakarta')
      .toDate()  
        : null;
const settlementTime = full.settlement_time
  ? moment
      .tz(full.settlement_time, 'YYYY-MM-DD HH:mm:ss', 'Asia/Jakarta')
      .toDate()  
        : null;
const trxExpirationTime = full.trx_expiration_time
  ? moment
      .tz(full.trx_expiration_time, 'YYYY-MM-DD HH:mm:ss', 'Asia/Jakarta')
      .toDate()  
        : null;

const cb = await prisma.transaction_callback.findFirst({
  where: { referenceId: orderId }
});
if (cb) {
  // update existing via id
  await prisma.transaction_callback.update({
    where: { id: cb.id },
    data: {
      updatedAt:         new Date(),
      settlementTime,
      trxExpirationTime,
    }
  });
} else {
  // buat baru
  await prisma.transaction_callback.create({
    data: {
      referenceId:         orderId,
      requestBody:         full,
      paymentReceivedTime,
      settlementTime,
      trxExpirationTime,
    }
  });
}

    // 4) Hitung status internal
    const isSuccess  = pgStatusRaw === 'COMPLETE'
    const newStatus  = isSuccess ? 'PAID' : pgStatusRaw
    const newSetSt   = settlementSt ?? (isSuccess ? 'PENDING' : pgStatusRaw)

    // 5) Ambil partner fee config
const orderRecord = await prisma.order.findUnique({
  where: { id: orderId },
  select: { userId: true }  // userId = partnerClient.id
})
if (!orderRecord) throw new Error('Order not found for callback')

const pc = await prisma.partnerClient.findUnique({
  where: { id: orderRecord.userId },
  select: { feePercent: true, feeFlat: true, weekendFeePercent: true, weekendFeeFlat: true, callbackUrl: true, callbackSecret: true }
})
if (!pc) throw new Error('PartnerClient not found for callback')


    // 6) Hitung fee Launcx

     const weekend = isJakartaWeekend(paymentReceivedTime ?? new Date())
    const pctFee  = weekend ? pc.weekendFeePercent ?? 0 : pc.feePercent ?? 0
    const flatFee = weekend ? pc.weekendFeeFlat ?? 0 : pc.feeFlat ?? 0

    const grossDec    = new Decimal(receivedAmt)
    const rawFee      = grossDec.times(pctFee).dividedBy(100)
    const feeLauncx   = rawFee
      .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
      .plus(new Decimal(flatFee))
    const pendingAmt  = isSuccess
      ? grossDec.minus(feeLauncx).toNumber()
      : null

    // 7) Update order
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status:           newStatus,
        settlementStatus: newSetSt,
        fee3rdParty:      0,
        feeLauncx:        isSuccess ? feeLauncx.toNumber() : null,
        pendingAmount:    pendingAmt,
        settlementAmount: isSuccess ? null : receivedAmt,
        updatedAt:        new Date(),
        paymentReceivedTime,
    settlementTime,
    trxExpirationTime,
      },
    })

    // 8) Ambil order untuk forward
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    if (isSuccess && order) {
      const client = await prisma.partnerClient.findUnique({
        where: { id: order.userId },
        select: { callbackUrl: true, callbackSecret: true }
      })
      if (client?.callbackUrl && client.callbackSecret) {
        const timestamp = new Date().toISOString()
        const nonce     = crypto.randomUUID()
        const payload = {
          orderId,
          status:           newStatus,
          settlementStatus: newSetSt,
          grossAmount:      order.amount,
          feeLauncx:        order.feeLauncx,
          netAmount:        order.pendingAmount,
          qrPayload:        order.qrPayload,
          timestamp,
          nonce,
        }
        const sig = crypto
          .createHmac('sha256', client.callbackSecret)
          .update(JSON.stringify(payload))
          .digest('hex')
        try {
          await postWithRetry(client.callbackUrl, payload, {
            headers: { 'X-Callback-Signature': sig },
            timeout: 5000
          })
          logger.info('[OY Callback] forwarded to client')
        } catch (err: any) {
          logger.error('[OY Callback] forward failed', err.message)
        }
      }
    }

    // 9) Ack OY
    return res.status(200).json(createSuccessResponse({ message: 'OK' }))

  } catch (err: any) {
    logger.error('[OY Callback] error:', err)
    return res.status(400).json(createErrorResponse(err.message))
  }
}

/* ═════════════════ 3. Inquiry status ═════════════════ */
export const checkPaymentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const resp = await paymentService.checkPaymentStatus(req)
    return res.status(200).json(createSuccessResponse(resp))
  } catch (err: any) {
    return res.status(400).json(createErrorResponse(err.message ?? 'Unable to fetch status'))
  }
}

export const retryOyCallback = async (req: Request, res: Response) => {
  const { referenceId } = req.params;
  try {
    // 1) Ambil record callback OY berdasarkan referenceId
    const cb = await prisma.transaction_callback.findFirst({
      where: { referenceId }
    });
    if (!cb) {
      return res.status(404).json({ error: 'Callback OY tidak ditemukan untuk ID ini' });
    }

    // 2) Rebuild request-like object
    const fakeReq: any = {
      rawBody: Buffer.from(JSON.stringify(cb.requestBody), 'utf8'),
      headers: {},       // OY QRIS callback tidak perlu signature
      // Express akan pakai rawBody, nggak perlu body parsed lagi
    };
    const fakeRes: any = {
      status(code: number) {
        return {
          json(payload: any) {
            // kita cuma ingin callback logic dijalankan, 
            // hasilnya tidak perlu ditangani di sini
            return Promise.resolve({ code, payload });
          }
        };
      }
    };

    // 3) Jalankan ulang handler OY
    await oyTransactionCallback(fakeReq, fakeRes);

    return res.json({ success: true, message: 'Callback OY berhasil di‐retry' });
  } catch (err: any) {
    logger.error('[Retry OY Callback] error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/* ═════════════════ 4. Order Aggregator (QR/Checkout) ═════════════════ */
export const createOrder = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).clientId as string;
    const amount = Number(req.body.amount);

    if (isNaN(amount) || amount <= 0) {
      return res
        .status(400)
        .json(createErrorResponse('`amount` harus > 0'));
    }

    const payload: OrderRequest = { userId, amount };
    // const order: OrderResponse = await paymentService.createOrder(payload);

    // Kembalikan JSON alih-alih redirect
    return res
      .status(200)
      // .json({ result: order });

  } catch (err: any) {
    return res
      .status(400)
      .json(createErrorResponse(err.message ?? 'Order creation failed'));
  }
};

/* ═════════════════ 5. Get order detail ═════════════════ */
export const getOrder = async (req: AuthRequest, res: Response) => {
  try {
    const order = await paymentService.getOrder(req.params.id)
    if (!order) return res.status(404).json(createErrorResponse('Order not found'))
    return res.status(200).json(createSuccessResponse(order))
  } catch (err: any) {
    return res.status(500).json(createErrorResponse(err.message ?? 'Unable to fetch order'))
  }
}

export default {
  createTransaction,
  transactionCallback,
  checkPaymentStatus,
  createOrder,
  retryOyCallback,        // ← tambahkan ini
  getOrder,
}
