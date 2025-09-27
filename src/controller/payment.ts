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
import { computeSettlement }     from '../service/feeSettlement'
import { postWithRetry }                from '../utils/postWithRetry'
import { cancelIng1Fallback } from '../service/ing1Fallback'
import { parseIng1Date, parseIng1Number, processIng1Update } from '../service/ing1Status'
import { cancelPiroFallback } from '../service/piroFallback'
import { cancelGenesisFallback } from '../service/genesisFallback'
import { processPiroUpdate } from '../service/piroStatus'
import { PiroClient, PiroConfig } from '../service/piroClient'
import { GenesisClient } from '../service/genesisClient'

import { isJakartaWeekend, wibTimestamp, wibTimestampString } from '../util/time'
import { verifyQrisMpmCallbackSignature } from '../service/gidiQrisIntegration'


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

    const paymentChannel = req.body.paymentChannel ?? req.body.payment_channel
    const customerEmail = req.body.customerEmail ?? req.body.customer_email
    const customerFullName = req.body.customerFullName ?? req.body.customer_full_name
    const customerPhone = req.body.customerPhone ?? req.body.customer_phone
    const walletId = req.body.walletId ?? req.body.wallet_id
    const walletIdType = req.body.walletIdType ?? req.body.wallet_id_type
    const transactionDescription = req.body.transactionDescription ?? req.body.transaction_description
    const expiredTime = req.body.expiredTime ?? req.body.expired_time

    // 4) validate
    if (isNaN(price) || price <= 0) {
      return res
        .status(400)
        .json(createErrorResponse('`price` harus > 0'))
    }
    const client = await prisma.partnerClient.findUnique({
      where: { id: clientId },
      select: { defaultProvider: true, forceSchedule: true }

    })
    if (!client) {
      return res
        .status(404)
        .json(createErrorResponse('PartnerClient tidak ditemukan'))
    }
    const partnerClientId = clientId
    const defaultProvider = (client.defaultProvider ?? 'hilogate').toLowerCase()
   const forceSchedule = client.forceSchedule ?? null

   if (
      defaultProvider !== 'hilogate' &&
      defaultProvider !== 'oy' &&
      defaultProvider !== 'gidi' &&
      defaultProvider !== 'ing1' &&
      defaultProvider !== 'piro'
    ) {
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
   subs = await getActiveProviders(merchant.id, 'hilogate', {
     schedule: (forceSchedule as any) || undefined,
   });
 } else if (defaultProvider === 'oy') {
   subs = await getActiveProviders(merchant.id, 'oy', {
     schedule: (forceSchedule as any) || undefined,
   });
 } else if (defaultProvider === 'gidi') {
   subs = await getActiveProviders(merchant.id, 'gidi', {
     schedule: (forceSchedule as any) || undefined,
   });
 } else if (defaultProvider === 'ing1') {
   subs = await getActiveProviders(merchant.id, 'ing1', {
     schedule: (forceSchedule as any) || undefined,
   });
 } else {
   subs = await getActiveProviders(merchant.id, 'piro', {
     schedule: (forceSchedule as any) || undefined,
   });
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
      sourceProvider: defaultProvider,
      paymentChannel,
      customerEmail,
      customerFullName,
      customerPhone,
      walletId,
      walletIdType,
      transactionDescription,
      expiredTime,
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
 const paymentReceivedTime = wibTimestamp(); // atau jika butuh Date object: new Date(wibTimestamp())
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
 updatedAt:             wibTimestamp(),
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

   await prisma.hilogateCallbackWatcher.updateMany({
      where: { refId: full.ref_id },
      data: { processed: true },
    });

    // 4) Extract fields
    const {
      ref_id: orderId,
      status: pgStatus,
      net_amount,
      total_fee: pgFee,
    qr_string,
    rrn,
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
      select: { merchantId: true, status: true }
    })
    if (!existing) throw new Error(`Order ${orderId} not found`)
    if (existing.status === 'SETTLED') {
      logger.info(`[Callback] Order ${orderId} already SETTLED; skipping update`)
      return res
        .status(200)
        .json(createSuccessResponse({ message: 'Order already settled' }))
    }
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
    const { fee: feeLauncxCalc, settlement: pendingCalc } = computeSettlement(grossAmount, {
      percent: pctFee,
      flat: flatFee,
    })

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,   // ← pakai newStatus yang sudah kamu hitung
        settlementStatus: newSetSt,
        qrPayload:        qr_string ?? null,
        rrn:              rrn ?? null,
        updatedAt:        wibTimestamp(),
        fee3rdParty:      pgFee,
        feeLauncx:        isSuccess ? feeLauncxCalc : null,
        pendingAmount:    isSuccess ? pendingCalc : null,
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
      const timestamp = wibTimestampString()
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

      // enqueue job for async delivery
      await prisma.callbackJob.create({
        data: {
          url:       partner.callbackUrl,
          payload:   clientPayload,
          signature: clientSig,
          partnerClientId: merchantId,
        },
      })
      logger.info('[Callback] Enqueued transaction callback')
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


export const ing1TransactionCallback = async (req: Request, res: Response) => {
  try {
    const extractString = (input: any): string | null => {
      if (input == null) return null;
      if (Array.isArray(input)) return extractString(input[0]);
      if (typeof input === 'string') {
        const trimmed = input.trim();
        return trimmed.length ? trimmed : null;
      }
      return String(input);
    };

    const clientReff =
      extractString(req.query.client_reff) ||
      extractString((req.query as any).clientReff) ||
      extractString((req.query as any).client_ref);
    if (!clientReff) throw new Error('Missing client_reff');

    const billerReff =
      extractString(req.query.reff) ||
      extractString((req.query as any).reference) ||
      extractString((req.query as any).reff_id);

    const rcRaw = extractString(req.query.rc ?? (req.query as any).RC);
    const rc = rcRaw != null && rcRaw !== '' ? Number(rcRaw) : null;
    const statusText = extractString(req.query.status);

    const grossAmount =
      parseIng1Number(
        (req.query as any).total ??
          req.query.amount ??
          (req.query as any).gross_amount ??
          (req.query as any).grossAmount
      ) ?? undefined;

    const paymentReceivedTime =
      parseIng1Date(
        (req.query as any).paid_at ??
          (req.query as any).payment_received_time ??
          (req.query as any).paidAt
      ) ?? undefined;

    const settlementTime =
      parseIng1Date(
        (req.query as any).settlement_time ??
          (req.query as any).settled_at ??
          (req.query as any).settlementTime
      ) ?? undefined;

    const expirationTime =
      parseIng1Date(
        (req.query as any).expired_at ??
          (req.query as any).expiration_time ??
          (req.query as any).expirationTime
      ) ?? undefined;

    const rawPayload = {
      ...Object.fromEntries(Object.entries(req.query).map(([key, value]) => [key, value])),
      _meta: {
        method: req.method,
        originalUrl: req.originalUrl,
      },
    };

    const existingCb = await prisma.transaction_callback.findFirst({
      where: { referenceId: clientReff },
    });

    if (existingCb) {
      await prisma.transaction_callback.update({
        where: { id: existingCb.id },
        data: {
          requestBody: rawPayload,
          updatedAt: wibTimestamp(),
          paymentReceivedTime,
          settlementTime,
          trxExpirationTime: expirationTime,
        },
      });
    } else {
      await prisma.transaction_callback.create({
        data: {
          referenceId: clientReff,
          requestBody: rawPayload,
          paymentReceivedTime,
          settlementTime,
          trxExpirationTime: expirationTime,
        },
      });
    }

    cancelIng1Fallback(clientReff);

    await processIng1Update({
      orderId: clientReff,
      rc,
      statusText,
      billerReff: billerReff ?? undefined,
      clientReff,
      grossAmount,
      paymentReceivedTime,
      settlementTime,
      expirationTime,
    });

    return res.status(200).json(createSuccessResponse({ message: 'OK' }));
  } catch (err: any) {
    logger.error('[ING1 Callback] Error:', err);
    return res.status(400).json(createErrorResponse(err.message ?? 'Unable to process callback'));
  }
};

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
 updatedAt:         wibTimestamp(),
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
      select: { userId: true, status: true }  // userId = partnerClient.id
    })
    if (!orderRecord) throw new Error('Order not found for callback')

    if (orderRecord.status === 'SETTLED') {
      logger.info(`[OY Callback] Order ${orderId} already SETTLED; skipping update`)
      return res
        .status(200)
        .json(createSuccessResponse({ message: 'Order already settled' }))
    }

    const pc = await prisma.partnerClient.findUnique({
      where: { id: orderRecord.userId },
      select: { feePercent: true, feeFlat: true, weekendFeePercent: true, weekendFeeFlat: true, callbackUrl: true, callbackSecret: true }
    })
    if (!pc) throw new Error('PartnerClient not found for callback')


    // 6) Hitung fee Launcx

     const weekend = isJakartaWeekend(paymentReceivedTime ?? new Date())
    const pctFee  = weekend ? pc.weekendFeePercent ?? 0 : pc.feePercent ?? 0
    const flatFee = weekend ? pc.weekendFeeFlat ?? 0 : pc.feeFlat ?? 0

    const { fee: feeLauncx, settlement: pendingAmt } = computeSettlement(receivedAmt, {
      percent: pctFee,
      flat: flatFee,
    })
    const pendingAmount = isSuccess ? pendingAmt : null

    // 7) Update order
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status:           newStatus,
        settlementStatus: newSetSt,
        fee3rdParty:      0,
        feeLauncx:        isSuccess ? feeLauncx : null,
        pendingAmount,
        settlementAmount: isSuccess ? null : receivedAmt,
 updatedAt:        wibTimestamp(),
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
          const timestamp = wibTimestampString()
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
        await prisma.callbackJob.create({
          data: {
            url:       client.callbackUrl,
            payload,
            signature: sig,
            partnerClientId: order.userId,
          },
        })
        logger.info('[OY Callback] enqueued to client')
      }
    }

    // 9) Ack OY
    return res.status(200).json(createSuccessResponse({ message: 'OK' }))

  } catch (err: any) {
    logger.error('[OY Callback] error:', err)
    return res.status(400).json(createErrorResponse(err.message))
  }
}

export const gidiTransactionCallback = async (req: Request, res: Response) => {
  let rawBody = '';
  try {
    rawBody = (req as any).rawBody.toString('utf8');
    logger.debug('[Gidi Callback] rawBody:', rawBody);

    const full = JSON.parse(rawBody);

    // 1. Resolve canonical orderId
    const orderId = full.invoiceId || full.ref_id || full.refId;
    if (!orderId) throw new Error('Missing invoiceId/ref_id');

    // 2. Load order to get subMerchantId, merchantId, userId
    const orderRec = await prisma.order.findUnique({
      where: { id: orderId },
      select: { subMerchantId: true, merchantId: true, userId: true },
    });
    if (!orderRec) throw new Error(`Order ${orderId} not found`);
    if (!orderRec.subMerchantId) throw new Error(`Order ${orderId} missing subMerchantId`);

    // 3. Fetch Gidi sub-merchant credentials to get credentialKey
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: orderRec.subMerchantId },
      select: { credentials: true },
    });
    if (!sub) throw new Error(`Gidi sub-merchant ${orderRec.subMerchantId} not found`);
    const rawCred = sub.credentials as any;
    const credentialKey = rawCred?.credentialKey;
    if (!credentialKey) throw new Error('Missing credentialKey for Gidi callback verification');

    // 4. Ensure merchantId is present for signature verification (some implementations expect it in payload)
    full.merchantId = full.merchantId || String(orderRec.merchantId);

    // 5. Verify signature using the correct credentialKey
    const isValid = verifyQrisMpmCallbackSignature({
      ...full,
      credentialKey,
    });
    if (!isValid) throw new Error('Invalid Gidi signature');

    // 6. Parse amounts / timestamps
    const grossAmount = Number(full.amount ?? full.gross_amount);
    if (isNaN(grossAmount)) throw new Error('Missing amount');

    const paymentReceivedTime = full.payment_time
      ? new Date(full.payment_time)
      : wibTimestamp();
    const settlementTime = full.settlement_time
      ? new Date(full.settlement_time)
      : null;
    const trxExpirationTime = full.expiration_time
      ? new Date(full.expiration_time)
      : null;

    // 7. Upsert callback record
    const existingCb = await prisma.transaction_callback.findFirst({
      where: { referenceId: orderId },
    });
    if (existingCb) {
      await prisma.transaction_callback.update({
        where: { id: existingCb.id },
        data: {
          updatedAt: wibTimestamp(),
          paymentReceivedTime,
          settlementTime,
          trxExpirationTime,
        },
      });
    } else {
      await prisma.transaction_callback.create({
        data: {
          referenceId: orderId,
          requestBody: full,
          paymentReceivedTime,
          settlementTime,
          trxExpirationTime,
        },
      });
    }

    // 8. Status mapping
    const upStatus = (full.status || '').toUpperCase();
    const isSuccess = ['SUCCESS', 'PAID', 'DONE', 'COMPLETED', 'SETTLED'].includes(upStatus);
    const newStatus = isSuccess ? 'PAID' : upStatus;
    const newSetSt =
      (full.settlement_status || '').toUpperCase() || (isSuccess ? 'PENDING' : null);

    // 9. Fetch partner for forwarding using userId (partnerClient)
    const partnerLookupId = orderRec.userId;
    if (!partnerLookupId) throw new Error(`Order ${orderId} missing userId for callback forwarding`);

    const partner = await prisma.partnerClient.findUnique({
      where: { id: partnerLookupId },
      select: {
        feePercent: true,
        feeFlat: true,
        weekendFeePercent: true,
        weekendFeeFlat: true,
        callbackUrl: true,
        callbackSecret: true,
      },
    });
    if (!partner) throw new Error(`PartnerClient ${partnerLookupId} not found`);

    // 10. Fee calculation
    const weekend = isJakartaWeekend(paymentReceivedTime);
    const pctFee = weekend ? partner.weekendFeePercent ?? 0 : partner.feePercent ?? 0;
    const flatFee = weekend ? partner.weekendFeeFlat ?? 0 : partner.feeFlat ?? 0;

    const { fee: feeLauncx, settlement } = computeSettlement(grossAmount, {
      percent: pctFee,
      flat: flatFee,
    });
    const pendingAmt = isSuccess ? settlement : null;

    // 11. Update order
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        settlementStatus: newSetSt,
        fee3rdParty: 0,
        feeLauncx: isSuccess ? feeLauncx : null,
        pendingAmount: pendingAmt,
        settlementAmount: isSuccess ? null : grossAmount,
        updatedAt: wibTimestamp(),
        paymentReceivedTime,
        settlementTime,
        trxExpirationTime,
      },
    });

    // 12. Enqueue partner callback if success
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (isSuccess && order && partner.callbackUrl && partner.callbackSecret) {
      const timestamp = wibTimestampString();
      const nonce = crypto.randomUUID();
      const payload = {
        orderId,
        status: newStatus,
        settlementStatus: newSetSt,
        grossAmount: order.amount,
        feeLauncx: order.feeLauncx,
        netAmount: order.pendingAmount,
        qrPayload: order.qrPayload,
        timestamp,
        nonce,
      };
      const sig = crypto
        .createHmac('sha256', partner.callbackSecret)
        .update(JSON.stringify(payload))
        .digest('hex');
      await prisma.callbackJob.create({
        data: {
          url: partner.callbackUrl,
          payload,
          signature: sig,
          partnerClientId: order.userId,
        },
      });
      logger.info('[Gidi Callback] Enqueued transaction callback');
    }

    return res.status(200).json(createSuccessResponse({ message: 'OK' }));
  } catch (err: any) {
    logger.error('[Gidi Callback] Error:', err);
    if (rawBody && !err.message.includes('Invalid')) {
      logger.debug('[Gidi Callback] rawBody on error:', rawBody);
    }
    return res.status(400).json(createErrorResponse(err.message || 'Unknown error'));
  }
};

export const piroTransactionCallback = async (req: Request, res: Response) => {
  let rawBody = ''
  try {
    rawBody = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {})
    logger.debug('[Piro Callback] rawBody:', rawBody)

    const signature =
      req.header('x-signature') ||
      req.header('X-Signature') ||
      req.header('x-piro-signature') ||
      req.header('X-Piro-Signature') ||
      ''
    const payload = JSON.parse(rawBody) as Record<string, any>

    const resolveString = (...keys: string[]): string | null => {
      for (const key of keys) {
        const value = payload[key]
        if (value == null) continue
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (trimmed) return trimmed
        } else if (typeof value === 'number') {
          return String(value)
        }
      }
      return null
    }

    const parseNumber = (value: any): number | undefined => {
      if (value == null || value === '') return undefined
      const num = Number(value)
      return Number.isFinite(num) ? num : undefined
    }

    const orderId =
      resolveString('reference_id', 'referenceId', 'order_id', 'orderId', 'invoice_id', 'invoiceId')
    if (!orderId) throw new Error('Missing referenceId')

    if (config.api.genesis.enabled) {
      const orderRecord = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          merchantId: true,
          subMerchantId: true,
          userId: true,
        },
      })

      if (!orderRecord?.merchantId) {
        throw new Error('Unable to resolve Genesis credentials for callback')
      }

      let schedule: 'weekday' | 'weekend' | undefined
      if (orderRecord.userId) {
        const partner = await prisma.partnerClient.findUnique({
          where: { id: orderRecord.userId },
          select: { forceSchedule: true },
        })
        schedule = (partner?.forceSchedule as any) || undefined
      }

      const subs = await getActiveProviders(orderRecord.merchantId, 'piro', {
        schedule,
      })
      if (!subs.length) {
        throw new Error('Genesis callback received but no active credentials found')
      }

      const picked = orderRecord.subMerchantId
        ? subs.find((s) => s.id === orderRecord.subMerchantId) ?? subs[0]
        : subs[0]
      const cfg = picked.config as PiroConfig
      const clientSecret =
        cfg.clientSecret || cfg.signatureKey || config.api.genesis.secret || ''
      if (!clientSecret) {
        throw new Error('Missing Genesis client secret for callback verification')
      }
      const clientId =
        (payload.clientId as string | undefined) ||
        (payload.client_id as string | undefined) ||
        cfg.clientId ||
        ''
      if (!clientId) {
        throw new Error('Missing Genesis client ID for callback verification')
      }

      const expected = GenesisClient.callbackSignature(payload, clientSecret, clientId)
      if (signature !== expected) throw new Error('Invalid Genesis signature')
      cancelGenesisFallback(orderId)
    } else {
      const signatureKey = config.api.piro.signatureKey
      if (!signatureKey) throw new Error('Missing Piro signature key configuration')

      const expected = PiroClient.callbackSignature(rawBody, signatureKey)
      if (signature !== expected) throw new Error('Invalid Piro signature')
      cancelPiroFallback(orderId)
    }

    await processPiroUpdate({
      orderId,
      status: resolveString('status', 'payment_status', 'paymentStatus') ?? '',
      paymentId: resolveString('payment_id', 'paymentId', 'id', 'TX', 'tx'),
      referenceId: resolveString('reference_id', 'referenceId', 'order_id', 'orderId'),
      grossAmount:
        parseNumber(
          payload.amount ??
            payload.gross_amount ??
            payload.grossAmount ??
            payload.amountSend ??
            payload.amount_send,
        ) ??
        parseNumber(payload.attachment?.amount?.value),
      netAmount: parseNumber(payload.net_amount ?? payload.netAmount),
      feeAmount: parseNumber(payload.fee ?? payload.fee_amount ?? payload.feeAmount),
      checkoutUrl:
        resolveString('checkout_url', 'checkoutUrl', 'redirect_url', 'redirectUrl') ?? null,
      qrContent:
        resolveString('qr_content', 'qrContent', 'qr_string', 'qrString', 'qr_image_url', 'qrImageUrl') ??
        null,
      paymentReceivedTime:
        resolveString('paid_at', 'paidAt', 'payment_time', 'paymentTime') ??
        (payload.attachment?.paidTime as string | undefined) ??
        undefined,
      settlementTime:
        resolveString('settled_at', 'settledAt', 'settlement_time', 'settlementTime') ?? undefined,
      expirationTime:
        resolveString('expired_at', 'expiredAt', 'expiration_time', 'expirationTime') ?? undefined,
      raw: payload,
    })

    return res.status(200).json(createSuccessResponse({ message: 'OK' }))
  } catch (err: any) {
    logger.error('[Piro Callback] Error:', err)
    if (rawBody) {
      logger.debug('[Piro Callback] rawBody on error:', rawBody)
    }
    return res
      .status(400)
      .json(createErrorResponse(err.message ?? 'Unable to process callback'))
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
  ing1TransactionCallback,
  gidiTransactionCallback,
  piroTransactionCallback,
  checkPaymentStatus,
  createOrder,
  retryOyCallback,        // ← tambahkan ini
  getOrder,
}
