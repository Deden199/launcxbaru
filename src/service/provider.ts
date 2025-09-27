/* ───────────────────────── src/service/provider.ts ───────────────────────── */
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../core/prisma';
import { HilogateClient, HilogateConfig } from '../service/hilogateClient';
import { OyClient, OyConfig } from '../service/oyClient';
import { GidiConfig } from '../service/gidi.service';
import { IfpClient, IfpConfig } from '../service/ifpClient';
import { Ing1Client, Ing1Config } from '../service/ing1Client';
import { PiroClient, PiroConfig } from '../service/piroClient';
import { GenesisClient, GenesisClientConfig } from '../service/genesisClient';
import { isJakartaWeekend } from '../util/time';

/* ═════════════════════════ Helpers ═════════════════════════ */
interface RawSub {
  id: string;
  provider: 'hilogate' | 'oy' | 'gidi' | 'ifp' | 'ing1' | 'piro';
  fee: number;
  credentials: unknown;
  schedule: unknown;
}

export interface ResultSub<C> {
  id: string; // sub_merchant.id
  provider: string;
  fee: number;
  config: C;
}

const decode2c2p = (raw: any, secret: string): any =>
  raw?.payload ? jwt.verify(raw.payload, secret) : raw;

const firstQRGroup = (opt: any) => {
  for (const cat of opt.channelCategories ?? [])
    for (const grp of cat.groups ?? [])
      if (typeof grp.code === 'string' && grp.code.toUpperCase().includes('QR'))
        return { category: cat, group: grp };
  return null;
};

const extractQR = (p: any): string | null =>
  typeof p.data === 'string'
    ? p.data
    : typeof p.qrString === 'string'
    ? p.qrString
    : typeof p.qrImageUrl === 'string'
    ? p.qrImageUrl
    : typeof p.data?.qrString === 'string'
    ? p.data.qrString
    : typeof p.data?.qrImageUrl === 'string'
    ? p.data.qrImageUrl
    : null;

// overload untuk Hilogate
export async function getActiveProviders(
  merchantId: string,
  provider: 'hilogate',
  opts?: { schedule?: 'weekday' | 'weekend' }
): Promise<ResultSub<HilogateConfig>[]>;

// overload untuk OY
export async function getActiveProviders(
  merchantId: string,
  provider: 'oy',
  opts?: { schedule?: 'weekday' | 'weekend' }
): Promise<ResultSub<OyConfig>[]>;

// overload untuk Gidi
export async function getActiveProviders(
  merchantId: string,
  provider: 'gidi',
  opts?: { schedule?: 'weekday' | 'weekend' }
): Promise<ResultSub<GidiConfig>[]>;

// overload untuk IFP
export async function getActiveProviders(
  merchantId: string,
  provider: 'ifp',
  opts?: { schedule?: 'weekday' | 'weekend' }
): Promise<ResultSub<IfpConfig>[]>;

// overload untuk ING1
export async function getActiveProviders(
  merchantId: string,
  provider: 'ing1',
  opts?: { schedule?: 'weekday' | 'weekend' }
): Promise<ResultSub<Ing1Config>[]>;

// overload untuk Piro
export async function getActiveProviders(
  merchantId: string,
  provider: 'piro',
  opts?: { schedule?: 'weekday' | 'weekend' }
): Promise<ResultSub<PiroConfig>[]>;

// implementasi
export async function getActiveProviders(
  merchantId: string,
  provider: 'hilogate' | 'oy' | 'gidi' | 'ifp' | 'ing1' | 'piro',
  opts: { schedule?: 'weekday' | 'weekend' } = {}
): Promise<
  Array<
    | ResultSub<HilogateConfig>
    | ResultSub<OyConfig>
    | ResultSub<GidiConfig>
    | ResultSub<IfpConfig>
    | ResultSub<Ing1Config>
    | ResultSub<PiroConfig>
  >
> {
  const isWeekend = opts.schedule
    ? opts.schedule === 'weekend'
    : isJakartaWeekend(new Date());
  const schedulePath = isWeekend ? 'weekend' : 'weekday';

  // 1) ambil dari DB
  const subs = await prisma.sub_merchant.findMany({
    where: {
      merchantId,
      provider,
    },
    select: {
      id: true,
      provider: true,
      fee: true,
      credentials: true,
      schedule: true,
    },
  });

  // 2) filter schedule aktif
  const activeSubs = subs.filter((s) => {
    const sch = (s.schedule as any) || {};
    if (sch.weekday == null && sch.weekend == null) {
      return true;
    }
    return !!sch[schedulePath];
  });

  // 3) map & cast dengan validasi minimal
  return activeSubs.map((s) => {
    const common = {
      id: s.id,
      provider: s.provider,
      fee: s.fee,
    };

    if (provider === 'hilogate') {
      const raw = s.credentials as any;
      if (!raw?.merchantId || !raw?.secretKey) {
        throw new Error(`Invalid Hilogate credentials for sub_merchant ${s.id}`);
      }
      const cfg: HilogateConfig = {
        merchantId: raw.merchantId,
        env: raw.env ?? 'sandbox',
        secretKey: raw.secretKey,
      };
      return {
        ...common,
        config: cfg,
      } as ResultSub<HilogateConfig>;
    } else if (provider === 'oy') {
      const raw = s.credentials as any;
      if (!raw?.merchantId || !raw?.secretKey) {
        throw new Error(`Invalid OY credentials for sub_merchant ${s.id}`);
      }
      const cfg: OyConfig = {
        baseUrl: process.env.OY_BASE_URL!,
        username: raw.merchantId,
        apiKey: raw.secretKey,
      };
      return {
        ...common,
        config: cfg,
      } as ResultSub<OyConfig>;
    } else if (provider === 'ifp') {
      const raw = s.credentials as any;
      if (!raw?.baseUrl || !raw?.clientId || !raw?.clientSecret) {
        throw new Error(`Invalid IFP credentials for sub_merchant ${s.id}`);
      }
      const cfg: IfpConfig = {
        baseUrl: raw.baseUrl,
        clientId: raw.clientId,
        clientSecret: raw.clientSecret,
        paymentChannel: raw.paymentChannel || raw.payment_channel,
      };
      return {
        ...common,
        config: cfg,
      } as ResultSub<IfpConfig>;
    } else if (provider === 'ing1') {
      const raw = s.credentials as any;
      const baseUrl = raw?.baseUrl ?? raw?.base_url;
      if (!baseUrl || !raw?.email || !raw?.password) {
        throw new Error(`Invalid ING1 credentials for sub_merchant ${s.id}`);
      }

      const cfg: Ing1Config = {
        baseUrl,
        email: raw.email,
        password: raw.password,
        productCode: raw.productCode ?? raw.product_code,
        callbackUrl: raw.callbackUrl ?? raw.callback_url ?? raw.return_url,
        permanentToken: raw.permanentToken ?? raw.permanent_token ?? raw.token,
        merchantId: raw.merchantId ?? raw.merchant_id,
        apiVersion: raw.apiVersion ?? raw.api_version ?? raw.version,
      };

      return {
        ...common,
        config: cfg,
      } as ResultSub<Ing1Config>;
    } else if (provider === 'piro') {
      const raw = s.credentials as any;
      const merchantId = raw?.merchantId ?? raw?.merchant_id;
      if (!merchantId) {
        throw new Error(`Invalid Piro credentials for sub_merchant ${s.id}`);
      }

      const { baseUrl, clientId, clientSecret, signatureKey, callbackUrl, deviceId, latitude, longitude } =
        config.api.piro;
      if (!baseUrl || !clientId || !signatureKey) {
        throw new Error('Piro environment credentials are not configured');
      }

      const cfg: PiroConfig = {
        baseUrl,
        clientId,
        clientSecret,
        signatureKey,
        merchantId: String(merchantId),
        storeId: raw?.storeId ?? raw?.store_id ?? undefined,
        terminalId: raw?.terminalId ?? raw?.terminal_id ?? undefined,
        channel:
          raw?.channel ??
          raw?.paymentChannel ??
          raw?.payment_channel ??
          raw?.defaultChannel ??
          raw?.default_channel ??
          undefined,
        callbackUrl:
          raw?.callbackUrl ??
          raw?.callback_url ??
          raw?.returnUrl ??
          raw?.return_url ??
          callbackUrl ?? config.api.callbackUrl,
        deviceId: raw?.deviceId ?? raw?.device_id ?? deviceId,
        latitude: String(raw?.latitude ?? raw?.lat ?? latitude ?? ''),
        longitude: String(raw?.longitude ?? raw?.long ?? longitude ?? ''),
      };

      return {
        ...common,
        config: cfg,
      } as ResultSub<PiroConfig>;
    } else {
      // gidi
      const raw = s.credentials as any;
      if (!raw?.baseUrl || !raw?.credentialKey) {
        throw new Error(`Invalid Gidi credentials for sub_merchant ${s.id}`);
      }
      // merchantId and subMerchantId might be provided; fallback to internal if missing
      const cfg: GidiConfig = {
        baseUrl: raw.baseUrl,
        merchantId: String(raw.merchantId ?? merchantId),
        subMerchantId: String(raw.subMerchantId ?? ''), // caller should supply a proper one if needed
        // requestId & transactionId will be auto-generated in generateDynamicQris/generateDynamicQrisFinal
        credentialKey: raw.credentialKey,
      };
      return {
        ...common,
        config: cfg,
      } as ResultSub<GidiConfig>;
    }
  });
}

/* ═════════════ Interface Provider ═════════════ */
export interface Provider {
  name: string;
  supportsQR: boolean;
  generateQR?: (p: { amount: number; orderId: string }) => Promise<string>;
  generateCheckoutUrl: (p: { amount: number; orderId: string }) => Promise<string>;
  checkStatus?: (p: { reff: string; clientReff?: string }) => Promise<{
    status: string;
    raw: any;
    rc?: number;
    message?: string;
  }>;
}

/* ═══════════ List provider aktif ═══════════ */
export async function getActiveProvidersForClient(
  merchantId: string,
  opts: { schedule?: 'weekday' | 'weekend' } = {}
): Promise<Provider[]> {
  const hilogateSubs = await getActiveProviders(merchantId, 'hilogate', opts);
  const oySubs = await getActiveProviders(merchantId, 'oy', opts);
  const gidiSubs = await getActiveProviders(merchantId, 'gidi', opts);
  const ifpSubs = await getActiveProviders(merchantId, 'ifp', opts);
  const ing1Subs = await getActiveProviders(merchantId, 'ing1', opts);
  const piroSubs = await getActiveProviders(merchantId, 'piro', opts);

  return [
    /* ──── Hilogate ──── */
    {
      name: 'hilogate',
      supportsQR: true,
      async generateQR({ orderId, amount }) {
        if (!hilogateSubs.length) throw new Error('No active Hilogate credentials');
        const raw = hilogateSubs[0].config as HilogateConfig;
        const cfg: HilogateConfig = {
          merchantId: raw.merchantId,
          secretKey: raw.secretKey,
          env: raw.env,
        };
        const client = new HilogateClient(cfg);
        const res = await client.createTransaction({ ref_id: orderId, amount });
        return (res as any).qr_code;
      },
      async generateCheckoutUrl({ orderId, amount }) {
        if (!hilogateSubs.length) throw new Error('No active Hilogate credentials');
        const cfg = hilogateSubs[0].config as unknown as HilogateConfig;
        const client = new HilogateClient(cfg);
        const res = await client.createTransaction({ ref_id: orderId, amount });
        return (res as any).checkout_url;
      },
    },

    /* ──── OY E-Wallet ──── */
    {
      name: 'oy',
      supportsQR: false,
      async generateCheckoutUrl({ orderId, amount }) {
        if (!oySubs.length) throw new Error('No active OY credentials');
        const cfg = oySubs[0].config as unknown as OyConfig;
        const client = new OyClient(cfg);
        const resp = await client.createEwallet({
          customer_id: orderId,
          partner_trx_id: orderId,
          amount,
          ewallet_code: 'DANA',
        });
        return resp.checkout_url;
      },
    },

    /* ──── Piro ──── */
    ((): Provider => {
      const pickConfig = (): PiroConfig => {
        if (!piroSubs.length) throw new Error('No active Piro credentials');
        return piroSubs[0].config as PiroConfig;
      };

      return {
        name: 'piro',
        supportsQR: true,
        async generateCheckoutUrl({ orderId, amount }) {
          const cfg = pickConfig();
          if (config.api.genesis.enabled) {
            const genesisCfg: GenesisClientConfig = {
              baseUrl: config.api.genesis.baseUrl || cfg.baseUrl || '',
              secret: config.api.genesis.secret || cfg.signatureKey || '',
              callbackUrl: config.api.genesis.callbackUrl || cfg.callbackUrl || config.api.callbackUrl,
              defaultClientId: cfg.clientId || undefined,
              defaultClientSecret:
                cfg.clientSecret || cfg.signatureKey || config.api.genesis.secret || undefined,
            };
            const client = new GenesisClient(genesisCfg);
            const resp = await client.generateQris({
              orderId,
              amount,
              clientId: genesisCfg.defaultClientId,
              clientSecret: genesisCfg.defaultClientSecret,
            });
            return resp.qrisData ?? '';
          }

          const client = new PiroClient(cfg);
          const resp = await client.createPayment({
            orderId,
            amount,
            callbackUrl: cfg.callbackUrl,
            channel: cfg.channel,
          });
          return resp.checkoutUrl ?? resp.qrContent ?? '';
        },
        async generateQR({ orderId, amount }) {
          const cfg = pickConfig();
          if (config.api.genesis.enabled) {
            const genesisCfg: GenesisClientConfig = {
              baseUrl: config.api.genesis.baseUrl || cfg.baseUrl || '',
              secret: config.api.genesis.secret || cfg.signatureKey || '',
              callbackUrl: config.api.genesis.callbackUrl || cfg.callbackUrl || config.api.callbackUrl,
              defaultClientId: cfg.clientId || undefined,
              defaultClientSecret:
                cfg.clientSecret || cfg.signatureKey || config.api.genesis.secret || undefined,
            };
            const client = new GenesisClient(genesisCfg);
            const resp = await client.generateQris({
              orderId,
              amount,
              clientId: genesisCfg.defaultClientId,
              clientSecret: genesisCfg.defaultClientSecret,
            });
            const qr = resp.qrisData ?? '';
            if (!qr) throw new Error('Genesis QR payload not available');
            return qr;
          }

          const client = new PiroClient(cfg);
          const resp = await client.createPayment({
            orderId,
            amount,
            callbackUrl: cfg.callbackUrl,
            channel: cfg.channel,
          });
          const qr = resp.qrContent ?? resp.checkoutUrl ?? '';
          if (!qr) throw new Error('Piro QR payload not available');
          return qr;
        },
        async checkStatus({ reff, clientReff }) {
          const cfg = pickConfig();
          if (config.api.genesis.enabled) {
            const genesisCfg: GenesisClientConfig = {
              baseUrl: config.api.genesis.baseUrl || cfg.baseUrl || '',
              secret: config.api.genesis.secret || cfg.signatureKey || '',
              callbackUrl: config.api.genesis.callbackUrl || cfg.callbackUrl || config.api.callbackUrl,
              defaultClientId: cfg.clientId || undefined,
              defaultClientSecret:
                cfg.clientSecret || cfg.signatureKey || config.api.genesis.secret || undefined,
            };
            const client = new GenesisClient(genesisCfg);
            const reference = reff || clientReff;
            if (!reference) throw new Error('Missing reference for Genesis inquiry');
            const resp = await client.queryQris({
              orderId: reference,
              clientId: genesisCfg.defaultClientId,
              clientSecret: genesisCfg.defaultClientSecret,
            });
            return {
              status: resp.status,
              raw: resp.raw,
            };
          }

          const client = new PiroClient(cfg);
          const reference = reff || clientReff;
          if (!reference) throw new Error('Missing reference for Piro inquiry');
          const resp = await client.getPaymentStatus(reference);
          return {
            status: resp.status,
            raw: resp.raw,
          };
        },
      };
    })(),

    /* ──── ING1 ──── */
    ((): Provider => {
      const computeSupportsQR = (cfg?: Ing1Config) => {
        const code = cfg?.productCode ?? '';
        return /qr/i.test(code);
      };

      const supportsQR = computeSupportsQR(
        (ing1Subs[0]?.config as Ing1Config | undefined) ?? undefined
      );

      return {
        name: 'ing1',
        supportsQR,
        async generateCheckoutUrl({ orderId, amount }) {
          if (!ing1Subs.length) throw new Error('No active ING1 credentials');
          const cfg = ing1Subs[0].config as Ing1Config;
          const client = new Ing1Client(cfg);
          const resp = await client.createCashin({
            amount,
            clientReff: orderId,
            remark: `Order ${orderId}`,
          });
          return resp.paymentUrl ?? resp.qrContent ?? '';
        },
        async generateQR({ orderId, amount }) {
          if (!supportsQR) {
            throw new Error('ING1 QR generation not supported for this product');
          }
          if (!ing1Subs.length) throw new Error('No active ING1 credentials');
          const cfg = ing1Subs[0].config as Ing1Config;
          const client = new Ing1Client(cfg);
          const resp = await client.createCashin({
            amount,
            clientReff: orderId,
            remark: `Order ${orderId}`,
          });
          if (!resp.qrContent) {
            throw new Error('ING1 did not return QR content');
          }
          return resp.qrContent;
        },
        async checkStatus({ reff, clientReff }) {
          if (!ing1Subs.length) throw new Error('No active ING1 credentials');
          const cfg = ing1Subs[0].config as Ing1Config;
          const client = new Ing1Client(cfg);
          const resp = await client.checkCashin({ reff, clientReff });
          return {
            status: resp.status,
            raw: resp.raw,
            rc: resp.rc,
            message: resp.message,
          };
        },
      };
    })(),

    /* ──── IFP ──── */
    {
      name: 'ifp',
      supportsQR: true,
      async generateQR({ orderId, amount }) {
        if (!ifpSubs.length) throw new Error('No active IFP credentials');
        const cfg = ifpSubs[0].config as IfpConfig;
        const client = new IfpClient(cfg);
        const resp = await client.createQrPayment({
          amount,
          payment_channel: cfg.paymentChannel || 'qris',
          customer: { name: orderId },
        });
        return resp.qr_string;
      },
      async generateCheckoutUrl({ orderId, amount }) {
        if (!ifpSubs.length) throw new Error('No active IFP credentials');
        const cfg = ifpSubs[0].config as IfpConfig;
        const client = new IfpClient(cfg);
        const resp = await client.createQrPayment({
          amount,
          payment_channel: cfg.paymentChannel || 'qris',
          customer: { name: orderId },
        });
        return resp.qr_url;
      },
    },

    /* ──── Netzme (stub) ──── */
    {
      name: 'netzme',
      supportsQR: true,
      generateQR: async ({ orderId }) => `NETZME_QR_${orderId}`,
      generateCheckoutUrl: async () => {
        throw new Error('generateCheckoutUrl tidak didukung untuk Netzme');
      },
    },

    /* ──── 2C2P Direct-QR ──── */
    ((): Provider => {
      const envVar = (k: string) => {
        const v = process.env[k];
        if (!v) throw new Error(`${k} not set in .env`);
        return v;
      };
      const mID = envVar('TCPP_MERCHANT_ID');
      const sk = envVar('TCPP_SECRET_KEY');
      const cID = envVar('TCPP_CLIENT_ID');
      const curr = envVar('TCPP_CURRENCY');
      const URLs = {
        token: envVar('TCPP_PAYMENT_TOKEN_URL'),
        option: envVar('TCPP_PAYMENT_OPTION_URL'),
        detail: envVar('TCPP_PAYMENT_OPTION_DETAILS_URL'),
        dopay: envVar('TCPP_DO_PAYMENT_URL'),
      };
      const returnUrl = `${config.api.baseUrl}:${config.api.port}/api/v1/transaction/callback`;

      return {
        name: '2c2p',
        supportsQR: true,
        async generateQR({ amount, orderId }) {
          const invoiceNo = orderId.replace(/\D/g, '').slice(0, 20) || `${Date.now()}`;
          const token = jwt.sign(
            {
              merchantID: mID,
              invoiceNo,
              description: `Pembayaran ${orderId}`,
              amount,
              currencyCode: curr,
              paymentChannel: ['QR'],
              backendReturnUrl: returnUrl,
            },
            sk,
            { algorithm: 'HS256' }
          );

          const tokenData = decode2c2p((await axios.post(URLs.token, { payload: token })).data, sk);
          if (tokenData.respCode !== '0000') throw new Error(tokenData.respDesc);

          const optData = decode2c2p(
            (
              await axios.post(URLs.option, {
                paymentToken: tokenData.paymentToken,
                clientID: cID,
                locale: 'en',
              })
            ).data,
            sk
          );
          const sel = firstQRGroup(optData);
          if (!sel) throw new Error('QR channel tidak tersedia');

          const det = decode2c2p(
            (
              await axios.post(URLs.detail, {
                paymentToken: tokenData.paymentToken,
                clientID: cID,
                locale: 'en',
                categoryCode: sel.category.code,
                groupCode: sel.group.code,
              })
            ).data,
            sk
          );

          const code = det.channels?.[0]?.payment?.code?.channelCode || sel.group.code;
          const doResp = decode2c2p(
            (
              await axios.post(URLs.dopay, {
                paymentToken: tokenData.paymentToken,
                clientID: cID,
                locale: 'en',
                responseReturnUrl: returnUrl,
                clientIP: '127.0.0.1',
                payment: { code: { channelCode: code }, data: {} },
              })
            ).data,
            sk
          );

          if (!['0000', '1005'].includes(doResp.respCode)) throw new Error(doResp.respDesc);
          const qr = extractQR(doResp);
          if (!qr) throw new Error('QR tidak ditemukan');
          return qr;
        },
        async generateCheckoutUrl() {
          throw new Error('Not implemented');
        },
      };
    })(),
  ];
}
