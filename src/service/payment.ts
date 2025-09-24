import { Request } from 'express';

import type { Bitmap } from 'jimp';

import QrCode from 'qrcode-reader'
const Jimp = require('jimp')
import { postWithRetry } from '../utils/postWithRetry';

import { brevoAxiosInstance } from '../core/brevo.axios';
import { prisma } from '../core/prisma';
import { Prisma } from '@prisma/client';
import logger from '../logger';
import { generateRandomId, getRandomNumber } from '../util/random';
import { getCurrentDate } from '../util/util';
import { wibTimestampString, wibTimestamp, formatDateJakarta } from '../util/time';

import { sendTelegramMessage } from '../core/telegram.axios';
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { getActiveProvidersForClient, Provider } from './provider';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { OyClient, OyConfig } from './oyClient';
import { IfpClient, IfpConfig } from './ifpClient';
import { getActiveProviders } from './provider';
import { generateDynamicQrisFinal, GidiConfig, GidiQrisResult } from './gidi.service';
import { scheduleHilogateFallback } from './hilogateFallback';
import { scheduleIng1Fallback } from './ing1Fallback';
import { Ing1Client, Ing1Config } from './ing1Client';
import { parseIng1Date, parseIng1Number, processIng1Update } from './ing1Status';

// ─── Internal checkout page hosts ──────────────────────────────────
const checkoutHosts = [
  'https://checkout1.launcx.com',
  'https://altcheckout.launcx.com',
  'https://payment.launcx.com',
  'https://c1.launcx.com',
];
const pickRandomHost = () =>
  checkoutHosts[Math.floor(Math.random() * checkoutHosts.length)];


export interface Transaction {
  merchantName: string;       // “gv” / “hilogate” / …
  price: number;
  buyer: string;
  flow?: 'embed' | 'redirect';
  playerId?: string;
  subMerchantId: string;         // ← tambahkan
  sourceProvider: string;       // ← tambahkan
  paymentChannel?: string;
  transactionDescription?: string;
  expiredTime?: number;
  customerEmail?: string;
  customerFullName?: string;
  customerPhone?: string;
  walletId?: string;
  walletIdType?: string;
}
export interface OrderRequest {
  amount: number;
  userId: string;
  playerId?: string;    // Optional: username/ID pemain di platform mereka
}
export interface OrderResponse {
  orderId: string;
  checkoutUrl: string;
  qrPayload?: string;
  playerId?: string;
  totalAmount: number;
  expiredTs?: string;         // optional, jika ingin masa kedaluwarsa
}
/* ═════════════ 1. Direct Transaction (GV / Netz / Hilogate) ═════════════ */
export const createTransaction = async (
  request: Transaction
): Promise<OrderResponse> => {
  const buyerId = request.buyer;

  // 1) Cek ENV override dulu
  let forced = config.api.forceProvider?.toLowerCase() || null;

  // 2) Kalau ENV nggak set, ambil defaultProvider dari PartnerClient
    let forceSchedule: string | null = null;

  if (!forced) {
    const pc = await prisma.partnerClient.findUnique({
      where: { id: buyerId },
      select: { defaultProvider: true, forceSchedule: true }
    });
    forced = pc?.defaultProvider?.toLowerCase() || null;
        forceSchedule = pc?.forceSchedule ?? null;
  } else {
    const pc = await prisma.partnerClient.findUnique({
      where: { id: buyerId },
      select: { forceSchedule: true }
    });
    forceSchedule = pc?.forceSchedule ?? null;
  }

  // 3) Tentukan provider akhir (forced > request.merchantName)
  const mName = forced || request.merchantName.toLowerCase();

  const amount = Number(request.price);
  const pid    = request.playerId ?? buyerId;

  if (mName === 'ing1') {
    const merchantRec = await prisma.merchant.findFirst({ where: { name: 'ing1' } });
    if (!merchantRec) throw new Error('Internal ING1 merchant not found');

    const trx = await prisma.transaction_request.create({
      data: {
        merchantId: merchantRec.id,
        subMerchantId: request.subMerchantId,
        buyerId: request.buyer,
        playerId: pid,
        amount,
        status: 'PENDING',
        settlementAmount: amount,
      },
    });
    const refId = trx.id;

    const ingSubs = await getActiveProviders(merchantRec.id, 'ing1', {
      schedule: (forceSchedule as any) || undefined,
    });
    if (!ingSubs.length) throw new Error('No active ING1 credentials');

    const ingCfg = ingSubs[0].config as Ing1Config;
    const ingClient = new Ing1Client(ingCfg);
    const cashinResp = await ingClient.createCashin({
      amount,
      clientReff: refId,
      remark: request.transactionDescription || `Payment ${refId}`,
    });

    await prisma.transaction_response.create({
      data: {
        referenceId: refId,
        responseBody: cashinResp.raw as Prisma.InputJsonValue,
        playerId: pid,
      },
    });

    const host = pickRandomHost();
    const fallbackCheckoutUrl = `${host}/order/${refId}`;
    const providerCheckoutUrl = cashinResp.paymentUrl ?? fallbackCheckoutUrl;

    const parseExpiry = (value: string | null | undefined) => {
      if (!value) return undefined;
      const trimmed = value.trim();
      const attempts = [trimmed];
      if (trimmed.includes(' ')) attempts.push(trimmed.replace(' ', 'T'));
      if (!trimmed.endsWith('Z')) {
        if (trimmed.includes(' ')) {
          attempts.push(trimmed.replace(' ', 'T') + 'Z');
        } else {
          attempts.push(`${trimmed}Z`);
        }
      }
      for (const candidate of attempts) {
        const ts = Date.parse(candidate);
        if (!Number.isNaN(ts)) return new Date(ts);
      }
      return undefined;
    };

    const expiration = parseExpiry(cashinResp.expiredAt);

    await prisma.order.create({
      data: {
        id: refId,
        userId: request.buyer,
        merchantId: merchantRec.id,
        subMerchant: { connect: { id: request.subMerchantId } },
        partnerClient: { connect: { id: request.buyer } },
        playerId: pid,
        amount,
        channel: 'ing1',
        status: 'PENDING',
        qrPayload: cashinResp.qrContent ?? null,
        checkoutUrl: providerCheckoutUrl,
        fee3rdParty: 0,
        settlementAmount: null,
        pgRefId: cashinResp.reff ?? null,
        pgClientRef: cashinResp.clientReff ?? null,
        providerPayload: (cashinResp.data ?? null) as Prisma.InputJsonValue,
        trxExpirationTime: expiration,
      },
    });

    scheduleIng1Fallback(refId, ingCfg, {
      reff: cashinResp.reff ?? null,
      clientReff: cashinResp.clientReff ?? null,
    });

    return {
      orderId: refId,
      checkoutUrl: providerCheckoutUrl,
      qrPayload: cashinResp.qrContent ?? undefined,
      playerId: pid,
      totalAmount: amount,
      expiredTs: cashinResp.expiredAt ?? undefined,
    };
  }

  // ─── Hilogate branch ───────────────────────────────────
  if (mName === 'hilogate') {
    // 1) Cari internal merchant Hilogate
    const merchantRec = await prisma.merchant.findFirst({ where: { name: 'hilogate' } });
    if (!merchantRec) {
      throw new Error('Internal Hilogate merchant not found');
    }

    // 2) Simpan transaction_request
    const trx = await prisma.transaction_request.create({
      data: {
        merchantId: merchantRec.id,
        subMerchantId:   request.subMerchantId, // ← connect ke sub‐merchant
        buyerId: request.buyer,
        playerId: pid,
        amount,
        status: 'PENDING',
        settlementAmount: amount,
      },
    });
    const refId = trx.id;

    // 3) Ambil kredensial aktif & instansiasi client
    const hilSubs = await getActiveProviders(merchantRec.id, 'hilogate', {
  schedule: forceSchedule as any || undefined,
});
if (!hilSubs.length) throw new Error('No active Hilogate credentials');

// ambil HilogateConfig dari properti `config`
const hilCfg = hilSubs[0].config as HilogateConfig;
const hilClient = new HilogateClient(hilCfg);

// panggil transaksi
const apiResp = await hilClient.createTransaction({
  ref_id: refId,
  method: 'qris',
  amount,
});

// bentuk respons createTransaction (sesuai implementasi `requestFull`) biasanya:
// {
//   code: number,
//   status: string,
//   data: {
//     qr_string: string,
//     checkout_url: string,
//     ...
//   }
// }
    const outer = apiResp.data;
    const qrString = outer.data.qr_string;

    // 4) Simpan audit log
    await prisma.transaction_response.create({
      data: {
        referenceId: refId,
        responseBody: apiResp,
        playerId: pid,
      },
    });

    // 5) Build internal checkout URL
    const host = pickRandomHost();
    const checkoutUrl = `${host}/order/${refId}`;


    // 7) Simpan ke tabel order untuk dashboard client
    await prisma.order.create({
      data: {
        id: refId,
        userId: request.buyer,
        merchantId: request.buyer,
        // connect relation to PartnerClient
        subMerchant:     { connect: { id: request.subMerchantId } }, // ← connect di order juga
        partnerClient: { connect: { id: request.buyer } },
        playerId: pid,
        amount,
        channel: 'hilogate',
        status: 'PENDING',
        qrPayload: qrString,
        checkoutUrl,
        fee3rdParty: 0,
        settlementAmount: null,
      },
    });
    await scheduleHilogateFallback(refId, hilCfg);

    // 8) Return response ke client
    return {
      orderId: refId,
      checkoutUrl,
      qrPayload: qrString,
      playerId: pid,
      totalAmount: amount,
    };
  }


 // ─── OY QRIS branch ───────────────────────────────────
if (mName === 'oy') {
  const merchantRec = await prisma.merchant.findFirst({ where: { name: 'oy' } })
  if (!merchantRec) throw new Error('Internal OY merchant not found')

  // 1) Simpan request
  const trx = await prisma.transaction_request.create({
    data: {
      merchantId:      merchantRec.id,
      subMerchantId:   request.subMerchantId, // ← connect ke sub‐merchant
      buyerId:         request.buyer,
      playerId:        pid,
      amount,
      status:          'PENDING',
      settlementAmount: amount,
    },
  })
  const refId = trx.id

  // 2) Panggil API OY
const oySubs = await getActiveProviders(merchantRec.id, 'oy', {
  schedule: forceSchedule as any || undefined,
});
if (!oySubs.length) throw new Error('No active OY credentials');

// ambil config dari properti `config`, bukan `credentials`
const oyCfg = oySubs[0].config as OyConfig;
const oyClient = new OyClient(oyCfg);

const qrResp = await oyClient.createQRISTransaction({
  partner_trx_id: refId,
  receive_amount: amount,
  need_frontend:  false,
  partner_user_id: pid,
});

  // **pakai proxy internal** daripada decode di server
  const proxyUrl = `${config.api.baseUrl}/api/v1/qris/${refId}`
  const host     = pickRandomHost()
  const checkoutUrl = `${host}/order/${refId}`

  // simpan audit log
  await prisma.transaction_response.create({
    data: {
      referenceId: refId,
      responseBody: qrResp as unknown as Prisma.InputJsonValue,
      playerId: pid,
    },
  })

  // simpan order
  await prisma.order.create({
    data: {
      id:            refId,
      userId:        request.buyer,
       merchantId:    merchantRec.id, // merchantId now references internal merchant
      // NOTE: future Gidi callbacks should fetch partner config via `order.userId`
      subMerchant:     { connect: { id: request.subMerchantId } }, // ← connect di order juga
      partnerClient: { connect: { id: request.buyer } },
      playerId:      pid,
      amount,
      channel:       'oy',
      status:        'PENDING',
      qrPayload:     proxyUrl,
      checkoutUrl,
      fee3rdParty:   0,
      settlementAmount: null,
    },
  })

  // kembalikan proxy URL
  return {
    orderId:     refId,
    checkoutUrl,
    qrPayload:   proxyUrl,
    playerId:    pid,
    totalAmount: amount,
  }
}


if (mName === 'ifp') {
  const merchantRec = await prisma.merchant.findFirst({ where: { name: 'ifp' } });
  if (!merchantRec) throw new Error('Internal IFP merchant not found');

  const trx = await prisma.transaction_request.create({
    data: {
      merchantId:      merchantRec.id,
      subMerchantId:   request.subMerchantId,
      buyerId:         request.buyer,
      playerId:        pid,
      amount,
      status:          'PENDING',
      settlementAmount: amount,
    },
  });
  const refId = trx.id;

  const ifpSubs = await getActiveProviders(merchantRec.id, 'ifp', {
    schedule: forceSchedule as any || undefined,
  });
  if (!ifpSubs.length) throw new Error('No active IFP credentials');

  const ifpCfg = ifpSubs[0].config as IfpConfig;
  const ifpClient = new IfpClient(ifpCfg);

  const paymentChannel = request.paymentChannel || ifpCfg.paymentChannel || 'qris';

  const paymentDetails: any = {
    amount,
    transaction_description:
      request.transactionDescription || `Payment ${refId}`,
  };
  if (request.expiredTime) paymentDetails.expired_time = request.expiredTime;

  const customerDetails: any = {
    email: request.customerEmail || `${pid}@mail.local`,
    full_name: request.customerFullName || pid,
  };
  if (request.customerPhone) customerDetails.phone = request.customerPhone;

  const walletDetails: any = {
    id: request.walletId || pid,
    id_type: request.walletIdType || 'phone_number',
  };

  const qrResp = await ifpClient.createQrPayment({
    external_id: refId,
    order_id: refId,
    amount,
    currency: 'IDR',
    payment_method: 'wallet',
    payment_channel: paymentChannel,
    payment_details: paymentDetails,
    customer_details: customerDetails,
    wallet_details: walletDetails,
    callback_url: config.api.callbackUrl,
  });

  await prisma.transaction_response.create({
    data: {
      referenceId: refId,
      responseBody: qrResp as unknown as Prisma.InputJsonValue,
      playerId: pid,
    },
  });

  const host = pickRandomHost();
  const checkoutUrl = `${host}/order/${refId}`;
  const qrPayload =
    (qrResp as any).qr_string ||
    (qrResp as any).qrString ||
    (qrResp as any).qr_url ||
    (qrResp as any).qrUrl ||
    '';

  await prisma.order.create({
    data: {
      id:            refId,
      userId:        request.buyer,
      merchantId:    merchantRec.id,
      subMerchant:   { connect: { id: request.subMerchantId } },
      partnerClient: { connect: { id: request.buyer } },
      playerId:      pid,
      amount,
      channel:       'ifp',
      status:        'PENDING',
      qrPayload,
      checkoutUrl,
      fee3rdParty:   0,
      settlementAmount: null,
    },
  });

  return {
    orderId:     refId,
    checkoutUrl,
    qrPayload,
    playerId:    pid,
    totalAmount: amount,
  };
}


// potongan khusus Gidi di createTransaction service (ganti bagian if (mName === 'gidi') {...})
if (mName === 'gidi') {
  // 1) Cari internal merchant Gidi
  const merchantRec = await prisma.merchant.findFirst({ where: { name: 'gidi' } });
  if (!merchantRec) throw new Error('Internal Gidi merchant not found');

  // 2) Simpan transaction_request
  const trx = await prisma.transaction_request.create({
    data: {
      merchantId:       merchantRec.id,          // internal merchant
      subMerchantId:    request.subMerchantId,   // incoming subMerchantId
      buyerId:          request.buyer,           // partner-client
      playerId:         pid,
      amount,
      status:           'PENDING',
      settlementAmount: amount,
    },
  });
  const refId = trx.id;

  // 3) Ambil kredensial aktif untuk Gidi
  const gidiSubs = await getActiveProviders(merchantRec.id, 'gidi', {
    schedule: forceSchedule as any || undefined,
  });
  if (!gidiSubs.length) throw new Error('No active Gidi credentials');

  // ResultSub<GidiConfig> tidak menyertakan requestId/transactionId; keduanya akan digenerate otomatis
  const rawCfg = gidiSubs[0].config as any;

  // validasi minimal
  if (!rawCfg.baseUrl) throw new Error('Gidi credential missing baseUrl');
  if (!rawCfg.credentialKey) throw new Error('Gidi credential missing credentialKey');
    if (!rawCfg.subMerchantId || isNaN(Number(rawCfg.subMerchantId))) {
    throw new Error('Gidi credential subMerchantId missing or non-numeric');
  }

  // 4) Bentuk GidiConfig lengkap sesuai dokumentasi
  const baseGidiCfg: Omit<GidiConfig, 'requestId' | 'transactionId'> = {
    baseUrl: rawCfg.baseUrl,
    merchantId: String(rawCfg.merchantId || merchantRec.id),
    subMerchantId: String(rawCfg.subMerchantId),
    credentialKey: rawCfg.credentialKey,
  };

  // 5) Panggil API generate QRIS dengan signature layer
    //    Sertakan waktu kedaluwarsa ~30 menit dari sekarang dalam format GIDI
  const now = wibTimestamp();
  const expireDate = new Date(now.getTime() + 30 * 60 * 1000);
  const datetimeExpired = formatDateJakarta(expireDate);

  let qrResult: GidiQrisResult;
  try {
    qrResult = await generateDynamicQrisFinal(
      baseGidiCfg,
      { amount, datetimeExpired },
      { autoPoll: true }
    );
    } catch (err: any) {
    logger.error(`[Gidi] generateDynamicQris failed for ${refId}`, err);
    throw new Error(`Gidi QRIS generation failed: ${err.message || 'unknown'}`);
  }

  const qrPayload = qrResult.qrPayload;
  const expiredTs = qrResult.expiredTs;
  // 6) Simpan audit log
  await prisma.transaction_response.create({
    data: {
      referenceId:  refId,
      responseBody: qrResult.raw ?? qrResult,
      playerId:     pid,
    },
  });

  // 7) Build checkout URL
  const host = pickRandomHost();
  const checkoutUrl = `${host}/order/${refId}`;

  // 8) Simpan order (internal merchantId + partnerClient)
  await prisma.order.create({
    data: {
      id:               refId,
      userId:           request.buyer,         // partner-client
      merchantId:       merchantRec.id,        // internal merchant
      subMerchant:      { connect: { id: request.subMerchantId } },
      partnerClient:    { connect: { id: request.buyer } },
      playerId:         pid,
      amount,
      channel:          'gidi',
      status:           'PENDING',
      qrPayload,
      checkoutUrl,
      fee3rdParty:      0,
      settlementAmount: null,
      trxExpirationTime: expiredTs ? new Date(expiredTs) : undefined,
    },
  });

  // 9) Return
  return {
    orderId:     refId,
    checkoutUrl,
    qrPayload,
    playerId:    pid,
    totalAmount: amount,
    expiredTs,
  };
}
  // —— GV branch —— 
  if (mName === 'gv' || mName === 'gudangvoucher') {
    let transactionObj;
    try {
      transactionObj = await prisma.transaction_request.create({
        data: {
          merchantId: '0',
          subMerchantId: '',
          buyerId: request.buyer || '',
          amount,
          status: 'PENDING',
          settlementAmount: amount,
        },
      });
    } catch (error) {
      logger.error('Failed to store GV Transaction Request', error);
      throw new Error('Failed to store Transaction Request for GV');
    }

    const { merchantId, merchantKey, qrisUrl } = config.api.gudangvoucher as any;
    const custom = `GVQ${Date.now()}`;
    const custom_redirect = Buffer.from(config.api.callbackUrl).toString('hex');
    const sig = crypto
      .createHash('md5')
      .update(`${merchantId}${amount}${merchantKey}${custom}`)
      .digest('hex');

    const formData = new URLSearchParams({
      merchantid: merchantId,
      custom,
      amount: amount.toString(),
      product: 'transaksi-produk',
      email: request.buyer,
      custom_redirect,
      page: 'JSON',
      signature: sig,
    });

    try {
      const { data } = await axios.post(qrisUrl, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (data.status_code === '00') return data;
      throw new Error(data.status_desc || 'GudangVoucher payment failed');
    } catch (err: any) {
      throw new Error(err.message || 'Error processing GudangVoucher payment');
    }
  }
};
  

export async function processHilogatePayload(payload: {
  ref_id: string;
  amount: number;
  method: string;
  status: string;
  net_amount: number;
  qr_string?: string;
  settlement_status?: string;
}) {
  const {
    ref_id: orderId,
    amount: grossAmount,
    status: pgStatus,
    net_amount,
    qr_string,
    settlement_status
  } = payload;

  // 1) Hit DB untuk ambil order & merchant
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { merchantId: true, amount: true, feeLauncx: true, status: true }
  });
  if (!existing) throw new Error(`Order ${orderId} not found`);

  // 2) Jika order sudah SETTLED, abaikan callback agar status tidak berubah
  if (existing.status === 'SETTLED') {
    return;
  }

  // 3) Hitung status internal
  const upStatus  = pgStatus.toUpperCase();
  const isSuccess = ['SUCCESS','DONE'].includes(upStatus);
  const newStatus = isSuccess ? 'PAID' : upStatus;
  const newSetSt  = settlement_status?.toUpperCase() ?? (isSuccess ? 'PENDING' : null);

  // 4) Update order di DB
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status:           newStatus,
      settlementStatus: newSetSt,
      pendingAmount:    isSuccess ? grossAmount : null,
      settlementAmount: isSuccess ? null       : net_amount,
      qrPayload:        qr_string ?? null,
      updatedAt:        new Date(),
    }
  });

  // 5) Forward ke partner jika sukses
  if (isSuccess) {
    const partner = await prisma.partnerClient.findUnique({
      where: { id: existing.merchantId },
      select: { callbackUrl: true, callbackSecret: true }
    });
      if (partner?.callbackUrl && partner.callbackSecret) {
        const timestamp = wibTimestampString();
      const nonce     = crypto.randomUUID();
      const clientPayload = {
        orderId,
        status:           newStatus,
        settlementStatus: newSetSt,
        grossAmount:      existing.amount,
        feeLauncx:        existing.feeLauncx,
        netAmount:        grossAmount,
        qrPayload:        qr_string,
        timestamp,
        nonce
      };
      const clientSig = crypto
        .createHmac('sha256', partner.callbackSecret)
        .update(JSON.stringify(clientPayload))
        .digest('hex');
      try {
        await postWithRetry(partner.callbackUrl, clientPayload, {
          headers: { 'X-Callback-Signature': clientSig },
          timeout: 5000,
        });
        logger.info('[Callback] Forwarded to client');
      } catch (err) {
        logger.error('[Callback] Forward failed', err);
      }
    }
  }
}

/* ═════════════ 2. Callback handler (signature + idempotensi) ═════════════ */
export const transactionCallback = async (request: Request) => {
  // langsung baca payload yang sudah ter-parse di controller
  const body = request.body;

  // Hilogate callback
  if (body.data?.ref_id) {
    const refId = body.data.ref_id;

    // simpan callback sekali saja
    const exists = await prisma.transaction_callback.findFirst({
      where: { referenceId: refId },
    });
    if (!exists) {
      await prisma.transaction_callback.create({
        data: { referenceId: refId, requestBody: body },
      });
      // update transaksi
      const status = body.data.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
      await prisma.transaction_request.update({
        where: { id: refId },
        data: { status },
      });
    }

    // notifikasi (telegram / email) tetap di sini
    try {
      const tx = await prisma.transaction_request.findUnique({
        where: { id: refId },
      });
      const merch = tx
        ? await prisma.merchant.findUnique({ where: { id: tx.merchantId } })
        : null;
      if (merch?.telegram) {
        const msg = [
          `Reference ID : ${refId}`,
          `Amount       : ${body.data.amount}`,
          `Status       : ${body.data.status}`,
        ].join('\n');
        await sendTelegramMessage(merch.telegram, msg);
      }
      if (merch?.email) {
        await brevoAxiosInstance.post('', {
          to: [{ email: merch.email }],
          templateId: 1,
          params: { amount: body.data.amount, status: body.data.status },
        });
      }
    } catch (err) {
      logger.error('Notification error', err);
    }

    return;
  }
  /* ─── 2C2P callback ─── */
  const sigHeader = request.headers['x-2c2p-signature'] as string | undefined;
  if (sigHeader) {
    const raw = JSON.stringify(body);
    const exp = crypto.createHmac('sha256', config.api.tcpp.secretKey).update(raw).digest('hex');
    if (sigHeader !== exp) throw new Error('Invalid 2C2P signature');
    const refId2 = body.originalPartnerReferenceNo || body.invoiceNo || body.referenceNo;
    if (!refId2) throw new Error('Missing 2C2P referenceId');
    const exists2 = await prisma.transaction_callback.findFirst({ where: { referenceId: refId2 } });
    if (!exists2) {
      await prisma.transaction_callback.create({ data: { referenceId: refId2, requestBody: body } });
      const status = body.respCode === '0000' ? 'SUCCESS' : 'FAILED';
      await prisma.transaction_request.update({ where: { id: refId2 }, data: { status } });
    }
    return;
  }
};

/* ═════════════ 3. Check Payment Status (with inquiry) ═════════════ */
export const checkPaymentStatus = async (req: Request) => {
  const refId = req.params.id || req.params.referenceId;
  const order = await prisma.order.findUnique({
    where: { id: refId },
    select: {
      id: true,
      status: true,
      userId: true,
      channel: true,
      merchantId: true,
      subMerchantId: true,
      pgRefId: true,
      pgClientRef: true,
    },
  });
  if (order) {
    if (order.status === 'PENDING') {
      const pc = await prisma.partnerClient.findUnique({
        where: { id: order.userId },
        select: { forceSchedule: true },
      });

      if (order.channel === 'ing1' && order.pgRefId) {
        try {
          let cfg: Ing1Config | null = null;
          if (order.merchantId) {
            const ingSubs = await getActiveProviders(order.merchantId, 'ing1', {
              schedule: (pc?.forceSchedule as any) || undefined,
            });
            if (ingSubs.length) {
              const matched = order.subMerchantId
                ? ingSubs.find((s) => s.id === order.subMerchantId)
                : null;
              cfg = (matched ?? ingSubs[0]).config as Ing1Config;
            }
          }

          if (cfg) {
            const ingClient = new Ing1Client(cfg);
            const resp = await ingClient.checkCashin({
              reff: order.pgRefId,
              clientReff: order.pgClientRef ?? order.id,
            });
            const data = resp.data ?? {};
            await processIng1Update({
              orderId: order.id,
              rc: resp.rc,
              statusText: (data.status as string) ?? resp.status,
              billerReff: resp.reff ?? order.pgRefId,
              clientReff: resp.clientReff ?? order.pgClientRef ?? order.id,
              grossAmount:
                parseIng1Number(data.total ?? data.amount ?? data.gross_amount ?? data.grossAmount) ?? undefined,
              paymentReceivedTime:
                parseIng1Date(data.paid_at ?? data.payment_received_time ?? data.paidAt) ?? undefined,
              settlementTime:
                parseIng1Date(data.settlement_time ?? data.settled_at ?? data.settlementTime) ?? undefined,
              expirationTime:
                parseIng1Date(data.expired_at ?? data.expiration_time ?? data.expirationTime) ?? undefined,
            });
            const refreshed = await prisma.order.findUnique({
              where: { id: order.id },
              select: { status: true },
            });
            if (refreshed) {
              order.status = refreshed.status;
            }
          }
        } catch (err: any) {
          logger.error(`[checkPaymentStatus] ING1 requery failed for ${order.id}: ${err.message}`);
        }
      } else {
        const providers = await getActiveProvidersForClient(order.userId, {
          schedule: (pc?.forceSchedule as any) || undefined,
        });
        const prov = providers.find((p) => p.name === order.channel) as any;
        if (prov?.checkStatus) {
          const newStat = await prov.checkStatus({ providerInvoice: order.id });
          if (newStat !== order.status) {
            await prisma.order.update({ where: { id: refId }, data: { status: newStat } });
            order.status = newStat;
          }
        }
      }
    }
    return { status: order.status };
  }
  const cb = await prisma.transaction_callback.findFirst({ where: { referenceId: refId } });
  return { status: cb ? 'DONE' : 'IN_PROGRESS' };
};


/* ═════════════ 5. Get Order ═════════════ */
export const getOrder = async (id: string) => prisma.order.findUnique({ where: { id } });

const paymentService = {
  createTransaction,
  transactionCallback,
  checkPaymentStatus,
  // createOrder,
  getOrder,
};
export default paymentService;
