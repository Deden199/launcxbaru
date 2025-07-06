/* ───────────────────────── src/service/provider.ts ───────────────────────── */
import axios from 'axios';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import HilogateClient from '../service/hilogateClient';

/* ═════════════════════════ Helpers ═════════════════════════ */

/** Jika respons 2C2P berisi `payload`, decode JWT; kalau tidak, kembalikan apa adanya. */
const decode2c2p = (raw: any, secret: string): any =>
  raw?.payload ? jwt.verify(raw.payload, secret) : raw;

/** Pilih kategori+grup pertama yang `code`-nya mengandung “QR”. */
const firstQRGroup = (opt: any) => {
  for (const cat of opt.channelCategories ?? [])
    for (const grp of cat.groups ?? [])
      if (typeof grp.code === 'string' && grp.code.toUpperCase().includes('QR'))
        return { category: cat, group: grp };
  return null;
};

/** Ekstrak QR (string / url) dari berbagai format DoPayment response. */
const extractQR = (p: any): string | null =>
  (typeof p.data        === 'string' ? p.data :
   typeof p.qrString    === 'string' ? p.qrString :
   typeof p.qrImageUrl  === 'string' ? p.qrImageUrl :
   typeof p.data?.qrString   === 'string' ? p.data.qrString :
   typeof p.data?.qrImageUrl === 'string' ? p.data.qrImageUrl :
   null);

/* ═════════════ Interface Provider ═════════════ */

export interface Provider {
  name: string;
  supportsQR: boolean;
  generateQR?:         (p: { amount: number; orderId: string }) => Promise<string>;
  generateCheckoutUrl: (p: { amount: number; orderId: string }) => Promise<string>;
}

/* ═══════════ List provider aktif (mock) ═══════════ */

export async function getActiveProvidersForClient(_: string): Promise<Provider[]> {
  return [

        /* ──── Hilogate (Aggregator) ──── */
        {
            name: 'hilogate',
            supportsQR: true,
            async generateQR({ orderId, amount }) {
              const res = await HilogateClient.createTransaction({ ref_id: orderId, amount });
              return res.data.qr_code;             // base64 QR
            },
            async generateCheckoutUrl({ orderId, amount }) {
              const res = await HilogateClient.createTransaction({ ref_id: orderId, amount });
              return res.data.checkout_url;        // redirect URL
            },
          },
    /* ───────── Netzme (stub) ───────── */
    {
      name: 'netzme',
      supportsQR: true,
      generateQR: async ({ orderId }) => `NETZME_QR_${orderId}`,
      generateCheckoutUrl: async () => {
        throw new Error('generateCheckoutUrl tidak didukung untuk Netzme');
      },
    },

    /* ───────── 2C2P Direct-QR (Sandbox) ───────── */
    ((): Provider => {
      /* Ambil ENV sekali di IIFE */
      const env = (k: string) => {
        const v = process.env[k];
        if (!v) throw new Error(`${k} not set in .env`);
        return v;
      };
      const merchantID  = env('TCPP_MERCHANT_ID');
      const secretKey   = env('TCPP_SECRET_KEY');
      const clientID    = env('TCPP_CLIENT_ID');
      const currency    = env('TCPP_CURRENCY');

      const URL_TOKEN   = env('TCPP_PAYMENT_TOKEN_URL');
      const URL_OPTION  = env('TCPP_PAYMENT_OPTION_URL');
      const URL_DETAILS = env('TCPP_PAYMENT_OPTION_DETAILS_URL');
      const URL_DOPAY   = env('TCPP_DO_PAYMENT_URL');

      const backendReturnUrl =
        `${config.api.baseUrl}:${config.api.port}/api/v1/transaction/callback`;

      return {
        name: '2c2p',
        supportsQR: true,

        /* ===== generateQR ===== */
        async generateQR({ amount, orderId }) {
          /* 1. PAYMENT TOKEN */
          const invoiceNo = orderId.replace(/[^0-9]/g, '').slice(0, 20) || `${Date.now()}`;
          const tokenJWT = jwt.sign({
            merchantID,
            invoiceNo,
            description: `Pembayaran ${orderId}`,
            amount: Number(amount.toFixed(2)),
            currencyCode: currency,
            paymentChannel: ['QR'],
            backendReturnUrl,
          }, secretKey, { algorithm: 'HS256' });

          const tokenData: any = decode2c2p(
            (await axios.post(URL_TOKEN, { payload: tokenJWT })).data, secretKey,
          );
          if (tokenData.respCode !== '0000')
            throw new Error(`PaymentToken ${tokenData.respCode}: ${tokenData.respDesc}`);

          const paymentToken = tokenData.paymentToken;

          /* 2. PAYMENT OPTION */
          const optionData: any = decode2c2p(
            (await axios.post(URL_OPTION, { paymentToken, clientID, locale: 'en' })).data,
            secretKey,
          );
          const sel = firstQRGroup(optionData);
          if (!sel) throw new Error('QR channel tidak tersedia untuk merchant ini');

          /* 3. PAYMENT OPTION DETAILS */
          const detailData: any = decode2c2p(
            (await axios.post(URL_DETAILS, {
              paymentToken,
              clientID,
              locale: 'en',
              categoryCode: sel.category.code,
              groupCode:    sel.group.code,
            })).data,
            secretKey,
          );

          const channelCode =
            detailData.channels?.[0]?.payment?.code?.channelCode || sel.group.code;
          if (!channelCode) throw new Error('channelCode tidak ditemukan');

          /* 4. DO PAYMENT (JSON polos) */
          const doResp: any = decode2c2p(
            (await axios.post(URL_DOPAY, {
              paymentToken,
              clientID,
              locale: 'en',
              responseReturnUrl: backendReturnUrl,
              clientIP: '127.0.0.1',
              payment: { code: { channelCode }, data: {} },
            })).data,
            secretKey,
          );

          if (!['0000', '1005'].includes(doResp.respCode))
            throw new Error(`DoPayment ${doResp.respCode}: ${doResp.respDesc}`);

          const qr = extractQR(doResp);
          if (!qr) throw new Error('QR tidak ditemukan pada DoPayment response');
          return qr;
        },

        /* ===== legacy /Charge (tak dipakai QR flow) ===== */
        async generateCheckoutUrl() {
          throw new Error('generateCheckoutUrl via /Charge tidak diimplementasi di sandbox');
        },
      };
    })(),
  ];
}
