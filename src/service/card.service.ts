import axios from 'axios';
import { config } from '../config';
import { prisma } from '../core/prisma';

// Internal checkout hosts for order records
const checkoutHosts = [
  'https://checkout1.launcx.com',
  'https://altcheckout.launcx.com',
  'https://payment.launcx.com',
  'https://c1.launcx.com',
];
const pickRandomHost = () =>
  checkoutHosts[Math.floor(Math.random() * checkoutHosts.length)];

/**
 * Pivot OAuth token cache
 */
const baseUrl = (config.api.paymentApi?.baseUrl || '').replace(/\/$/, '');

type TokenState = { accessToken: string | null; expiresAt: number };
const tokenState: TokenState = { accessToken: null, expiresAt: 0 };

const getPivotToken = async (): Promise<string> => {
  const now = Date.now();
  if (tokenState.accessToken && tokenState.expiresAt > now) return tokenState.accessToken;
  return await requestNewToken();
};

const requestNewToken = async (): Promise<string> => {
  const clientId = config.api.paymentApi?.apiKey || '';
  const clientSecret = config.api.paymentApi?.apiSecret || '';
  if (!baseUrl) throw new Error('PAYMENT_API_URL is not set');
  if (!clientId || !clientSecret) throw new Error('PAYMENT_API_KEY/SECRET is not set');

  const url = `${baseUrl}/v1/access-token`;
  const resp = await axios.post(
    url,
    { grantType: 'client_credentials' },
    {
      headers: {
        'X-MERCHANT-ID': clientId,
        'X-MERCHANT-SECRET': clientSecret,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  const data = resp.data?.data;
  if (!data?.accessToken || !data?.expiresIn) throw new Error('Pivot token response invalid');

  const ttlMs = Number(data.expiresIn) * 1000;
  tokenState.accessToken = data.accessToken;
  tokenState.expiresAt = Date.now() + ttlMs - 30_000; // buffer 30s
  return tokenState.accessToken!;
};

const refreshPivotToken = async (): Promise<string> => requestNewToken();

const withBearer = (token: string) => ({
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 20000,
});

const pivotPost = async (path: string, payload: any) => {
  let token = await getPivotToken();
  try {
    return await axios.post(`${baseUrl}${path}`, payload, withBearer(token));
  } catch (e: any) {
    if (e?.response?.status === 401) {
      token = await refreshPivotToken();
      return await axios.post(`${baseUrl}${path}`, payload, withBearer(token));
    }
    throw e;
  }
};

const pivotGet = async (path: string) => {
  let token = await getPivotToken();
  try {
    return await axios.get(`${baseUrl}${path}`, withBearer(token));
  } catch (e: any) {
    if (e?.response?.status === 401) {
      token = await refreshPivotToken();
      return await axios.get(`${baseUrl}${path}`, withBearer(token));
    }
    throw e;
  }
};

/**
 * Error handler — perjelas pesan dari provider
 */
const handleError = (err: any) => {
  const status = err.response?.status || 500;
  const provider = err.response?.data;
  const message =
    provider?.message ||
    provider?.error ||
    err.message ||
    'Provider error';
  const error = new Error(
    `[Provider ${status}] ${message}` +
    (provider?.code ? ` (code: ${provider.code})` : '') +
    (provider?.data ? ` | data: ${JSON.stringify(provider.data)}` : '')
  );
  (error as any).status = status;
  throw error;
};

/** Util: buat clientReferenceId kalau tidak diberikan */
const makeClientRef = (hint?: string) =>
  hint || `REF-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Ambil id dari berbagai bentuk respons provider */
const pickId = (obj: any): string | null => {
  if (!obj || typeof obj !== 'object') return null;
  const direct = obj.id;
  if (typeof direct === 'string' && direct) return direct;
  const paths = [['data','id'], ['result','id'], ['paymentSession','id']];
  for (const p of paths) {
    let cur: any = obj;
    for (const key of p) cur = cur?.[key];
    if (typeof cur === 'string' && cur) return cur;
  }
  return null;
};

/** Ambil encryptionKey/publicKey dari berbagai bentuk respons provider */
const pickEncryptionKey = (obj: any): string | null => {
  if (!obj || typeof obj !== 'object') return null;

  // kandidat top-level
  const candidates = [
    'encryptionKey', 'publicKey', 'rsaPublicKey',
    'cardEncryptionKey', 'encryptionPublicKey',
  ];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 60) return v;
  }

  // nested umum
  const nested = [
    ['data', 'encryptionKey'],
    ['result', 'encryptionKey'],
    ['paymentSession', 'encryptionKey'],
    ['encryption', 'publicKey'],
    ['card', 'encryptionKey'],
  ];
  for (const path of nested) {
    let cur: any = obj;
    for (const key of path) cur = cur?.[key];
    if (typeof cur === 'string' && cur.length > 60) return cur;
  }

  return null;
};

/**
 * Create Payment Session (sesuai dok) — DIJAMIN return { id, encryptionKey, ...raw }
 */
export const createCardSession = async (
  amount: number,
  currency: string,
  customer: any,
  order: any,
  opts?: {
    statementDescriptor?: string;
    expiryAt?: string; // ISO
    metadata?: Record<string, any>;
    paymentType?: 'SINGLE' | 'RECURRING';
    clientReferenceId?: string;
  },
  meta?: { buyerId: string; subMerchantId: string; playerId?: string }
) => {
  try {
    const redirectBase = config.api.frontendBaseUrl;
    if (!redirectBase) throw new Error('FRONTEND_BASE_URL environment variable is required');
    const base = redirectBase.replace(/\/$/, '');

    const amountValue = Math.round(Number(amount) || 0);
    if (!amountValue || amountValue <= 0) throw new Error('amount must be > 0');

    // Create transaction_request before calling provider
    let merchantId: string | undefined;
    if (meta?.subMerchantId) {
      try {
        const sub = await prisma.sub_merchant.findUnique({
          where: { id: meta.subMerchantId },
          select: { merchantId: true },
        });
        merchantId = sub?.merchantId;
      } catch {
        /* ignore lookup errors */
      }
    }
    if (meta?.buyerId && meta?.subMerchantId) {
      try {
        await prisma.transaction_request.create({
          data: {
            merchantId: merchantId,
            subMerchantId: meta.subMerchantId,
            buyerId: meta.buyerId,
            playerId: meta.playerId,
            amount: amountValue,
            status: 'PENDING',
            settlementAmount: amountValue,
          },
        });
      } catch {
        /* ignore DB errors to avoid breaking flow */
      }
    }

    const payload: any = {
      clientReferenceId: makeClientRef(opts?.clientReferenceId),
      mode: 'API',
      paymentType: opts?.paymentType ?? 'SINGLE',
      paymentMethod: { type: 'CARD' },
      autoConfirm: false,
      redirectUrl: {
        successReturnUrl: `${base}/payment-success`,
        failureReturnUrl: `${base}/payment-failure`,
        expirationReturnUrl: `${base}/payment-expired`,
      },
      amount: { value: amountValue, currency: String(currency || 'IDR').toUpperCase() },
      customer,                // opsional
      orderInformation: order, // opsional
    };

    if (opts?.statementDescriptor) payload.statementDescriptor = opts.statementDescriptor;
    if (opts?.expiryAt) payload.expiryAt = opts.expiryAt;
    if (opts?.metadata) payload.metadata = opts.metadata;

    // Create session
    const resp = await pivotPost('/v2/payments', payload);
    const raw = resp?.data ?? {};

    // Normalize id & encryptionKey
    let id = pickId(raw);
    let encryptionKey = pickEncryptionKey(raw);

    // Fallback: GET detail kalau create tidak menyertakan public key
    if ((!encryptionKey || !id) && id) {
      const det = await pivotGet(`/v2/payments/${id}`);
      const detRaw = det?.data ?? det ?? {};
      encryptionKey = encryptionKey || pickEncryptionKey(detRaw);
      id = id || pickId(detRaw);
    }

    if (!id || !encryptionKey) {
      const e: any = new Error('Provider did not return encryptionKey');
      e.status = 502;
      throw e;
    }

    // Store raw response
    try {
      await prisma.transaction_response.create({
        data: { referenceId: id, responseBody: raw },
      });
    } catch {
      /* ignore DB errors */
    }

    // Create order record for dashboard
    if (meta?.buyerId && meta?.subMerchantId) {
      const host = pickRandomHost();
      try {
        await prisma.order.create({
          data: {
            id,
            userId: meta.buyerId,
            merchantId,
            subMerchant: { connect: { id: meta.subMerchantId } },
            partnerClient: { connect: { id: meta.buyerId } },
            playerId: meta.playerId,
            amount: amountValue,
            channel: 'card',
            status: 'PENDING',
            checkoutUrl: `${host}/order/${id}`,
            fee3rdParty: 0,
            settlementAmount: null,
          },
        });
      } catch {
        /* ignore DB errors */
      }
    }

    // Kembalikan bentuk stabil untuk controller/FE
    return { id, encryptionKey, ...raw };
  } catch (err: any) {
    handleError(err);
  }
};

/**
 * Confirm Payment Session (sesuai dok)
 */
export const confirmCardSession = async (
  id: string,
  encryptedCard: string,
  paymentMethodOptions?: {
    card?: {
      captureMethod?: 'automatic' | 'manual' | string;
      threeDsMethod?: 'CHALLENGE' | 'AUTO' | string;
      processingConfig?: { bankMerchantId?: string | null; merchantIdTag?: string | null } | null;
    };
  }
) => {
  try {
    // ---- (opsional) preflight: baca status session untuk diagnosa ----
    let preStatus: string | undefined;
    try {
      const pre = await pivotGet(`/v2/payments/${id}`);
      const raw = pre?.data ?? pre ?? {};
      preStatus =
        raw?.status ||
        raw?.data?.status ||
        raw?.result?.status ||
        raw?.paymentSession?.status;
      if (preStatus) {
        // eslint-disable-next-line no-console
        console.log(`[confirmCardSession] Pre-status for ${id}: ${preStatus}`);
      }
    } catch {
      /* ignore preflight failure */
    }

    // ---- Sanitize options: kirim hanya properti valid & non-null ----
    const input = paymentMethodOptions?.card || {};
    const cardOpts: Record<string, any> = {};

    // captureMethod → lowercase & whitelist
    if (typeof input.captureMethod === 'string') {
      const v = input.captureMethod.toLowerCase();
      if (v === 'automatic' || v === 'manual') cardOpts.captureMethod = v;
    }

    // threeDsMethod → uppercase & whitelist
    if (typeof input.threeDsMethod === 'string') {
      const v = input.threeDsMethod.toUpperCase();
      if (v === 'CHALLENGE' || v === 'AUTO') cardOpts.threeDsMethod = v;
    }

    // processingConfig → hapus key yang null/undefined, kirim hanya jika ada isi
    if (input.processingConfig && typeof input.processingConfig === 'object') {
      const pc: Record<string, any> = { ...input.processingConfig };
      Object.keys(pc).forEach(k => (pc as any)[k] == null && delete (pc as any)[k]);
      if (Object.keys(pc).length > 0) cardOpts.processingConfig = pc;
    }

    // Bangun body; hanya sertakan paymentMethodOptions jika cardOpts tidak kosong
    const body: any = {
      paymentMethod: { type: 'CARD', card: { encryptedCard } },
    };
    if (Object.keys(cardOpts).length > 0) {
      body.paymentMethodOptions = { card: cardOpts };
    }

    const resp = await pivotPost(`/v2/payments/${id}/confirm`, body);
    const raw = resp.data;

    // store provider response
    try {
      await prisma.transaction_response.create({
        data: { referenceId: id, responseBody: raw },
      });
    } catch {
      /* ignore DB errors */
    }

    // update order status if exists
    try {
      const status =
        raw?.status ||
        raw?.data?.status ||
        raw?.result?.status ||
        raw?.paymentSession?.status;
      if (status) {
        await prisma.order.update({
          where: { id },
          data: { status: String(status) },
        });
      }
    } catch {
      /* ignore DB errors */
    }

    return raw;
  } catch (err: any) {
    // Log mentah dari provider agar alasan 4xx/5xx kebaca jelas di log
    try {
      // eslint-disable-next-line no-console
      console.error('[PIVOT RAW ERROR]', JSON.stringify(err?.response?.data, null, 2));
    } catch {}

    // Map khusus 422 "not allowed to confirm payment session" → 409 + pesan actionable
    const provider = err?.response?.data;
    const rawStr = JSON.stringify(provider || {});
    if (err?.response?.status === 422 && /not allowed to confirm payment session/i.test(rawStr)) {
      const e: any = new Error(
        'Session cannot be confirmed (likely expired, already confirmed, or created under a different merchant token). ' +
        'Create a new session and retry the confirm immediately.'
      );
      e.status = 409;
      // sematkan detail provider bila ada
      (e as any).provider = provider;
      throw e;
    }

    // Default error handling
    handleError(err);
  }
};


export const getPayment = async (id: string) => {
  try {
    const resp = await pivotGet(`/v2/payments/${id}`);
    return resp.data;
  } catch (err: any) {
    handleError(err);
  }
};

export default { createCardSession, confirmCardSession, getPayment };
