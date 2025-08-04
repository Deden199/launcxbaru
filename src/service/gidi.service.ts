// gidi-full.service.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import QRCode from 'qrcode';

export interface GidiConfig {
  baseUrl: string;
  merchantId: string;        // numeric string per doc
  subMerchantId: string;     // numeric string
  requestId?: string;        // unique per request
  transactionId?: string;    // unique per request
  credentialKey: string;     // secret used in signature layering
}

export interface GenerateDynamicQrisParams {
  amount: number;
  datetimeExpired?: string; // "yyyy-MM-dd HH:mm:ss" per doc
}

export interface GidiQrisResult {
  qrPayload: string;
  expiredTs?: string;
  checkoutUrl?: string;
  raw?: any;
}

export type GenerateDynamicQrisOutcome =
  | { status: 'ready'; result: GidiQrisResult }
  | {
      status: 'pending';
      pendingInfo: {
        requestId: string;
        transactionId: string;
        datetimeExpired?: string;
        raw: any;
      };
    };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: string) => String(s).trim();

export function generateRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function normalizeGidiResponse(rawResponse: any): {
  qrPayload: string;
  expiredTs?: string;
  checkoutUrl?: string;
} {
  const data: any = rawResponse?.data || rawResponse || {};

  let expiredTs =
    data.expiredTs || data.expired_ts || data.expiration_time || undefined;

  if (!expiredTs) {
    const candidate =
      rawResponse?.responseDetail?.datetimeExpired ||
      data?.responseDetail?.datetimeExpired ||
      rawResponse?.data?.responseDetail?.datetimeExpired ||
      data?.data?.responseDetail?.datetimeExpired;

    if (candidate) {
      const parsed = new Date(candidate);
      if (!isNaN(parsed.getTime())) {
        expiredTs = parsed.toISOString();
      }
    }
  }

  const detail =
    rawResponse?.responseDetail ||
    data?.responseDetail ||
    rawResponse?.data?.responseDetail ||
    data?.data?.responseDetail ||
    {};

  let qrPayload =
    detail?.rawData ||
    data?.qrString ||
    data?.qr_string ||
    data?.qr_payload ||
    data?.qrPayload ||
    '';

  if (!qrPayload) {
    const altDetail =
      rawResponse?.data?.responseDetail ||
      data?.data?.responseDetail ||
      undefined;
    if (altDetail) {
      qrPayload = altDetail.rawData || '';
    }
  }

  const checkoutUrl = data.checkoutUrl || data.checkout_url || undefined;

  return {
    qrPayload: String(qrPayload || '').trim(),
    expiredTs: expiredTs ? String(expiredTs) : undefined,
    checkoutUrl: checkoutUrl ? String(checkoutUrl) : undefined,
  };
}

export async function generateDynamicQris(
  config: GidiConfig,
  params: GenerateDynamicQrisParams
): Promise<GenerateDynamicQrisOutcome> {
  const client: AxiosInstance = axios.create({
    baseURL: config.baseUrl,
    headers: { 'Content-Type': 'application/json' },
    timeout: 7000,
  });

  if (isNaN(parseInt(config.merchantId, 10))) {
    throw new Error(`Invalid Gidi merchantId, must be integer-like: ${config.merchantId}`);
  }
  if (isNaN(parseInt(config.subMerchantId, 10))) {
    throw new Error(`Invalid Gidi subMerchantId, must be integer-like: ${config.subMerchantId}`);
  }

  let requestId = config.requestId ?? generateRequestId();
  let transactionId = config.transactionId ?? generateRequestId();
  if (requestId === transactionId) {
    transactionId = generateRequestId();
    console.info(
      '[Gidi][generateDynamicQris] requestId === transactionId; regenerated transactionId to avoid DOUBLE_REQUEST_ID.'
    );
  }

  const m = clean(config.merchantId);
  const s = clean(config.subMerchantId);
  const r = clean(requestId);
  const t = clean(transactionId);
  const k = clean(config.credentialKey);
  const amt = String(params.amount);

  const innerRaw = `${s}${r}${t}${amt}${k}`;
  const innerHash = crypto.createHash('sha256').update(innerRaw, 'utf8').digest('hex');
  const outerRaw = `${m}${innerHash}`;
  const signature = crypto.createHash('sha256').update(outerRaw, 'utf8').digest('hex');

  console.debug('[Gidi][generateDynamicQris] signature components', {
    merchantId: m,
    subMerchantId: s,
    requestId: r,
    transactionId: t,
    amount: amt,
    credentialKeySnippet: k.slice(0, 6) + '…',
    innerRaw,
    innerHash,
    outerRaw,
    signature,
  });

  const body: Record<string, any> = {
    merchantId: parseInt(m, 10),
    subMerchantId: parseInt(s, 10),
    requestId: r,
    transactionId: t,
    amount: params.amount,
    signature,
  };
  if (params.datetimeExpired) {
    body.datetimeExpired = params.datetimeExpired;
  }

  console.debug('[Gidi][generateDynamicQris] sending request', {
    body: { ...body, signature: '[redacted]' },
  });

  const maxRetries = 2;
  let attempt = 0;
  let lastErr: any = null;

  while (attempt <= maxRetries) {
    try {
      const res = await client.post('/QrisMpm/generateDynamic', body);
      const rawResponse = res.data || {};

      const respCodeRaw = rawResponse.responseCode || '';
      const respCode = String(respCodeRaw).toUpperCase();
      const respMsg = rawResponse.responseMessage || rawResponse.message || '';

      const statusGenerate =
        rawResponse?.responseDetail?.statusGenerate ||
        rawResponse?.responseDetail?.status_generate ||
        '';

      if (respCode === 'SUCCESS' && statusGenerate && statusGenerate.toLowerCase() === 'pending') {
        return {
          status: 'pending',
          pendingInfo: {
            requestId: r,
            transactionId: t,
            datetimeExpired:
              rawResponse?.responseDetail?.datetimeExpired ||
              rawResponse?.responseDetail?.datetime_expired,
            raw: rawResponse,
          },
        };
      }

      if (respCode === 'SERVICE_NOT_ALLOWED') {
        throw new Error(`Gidi terminal error SERVICE_NOT_ALLOWED: ${respMsg}`);
      }

      if (respCode && respCode !== 'SUCCESS' && respCode !== '00') {
        if (respCode === 'INVALID_SIGNATURE') {
          throw new Error(`Gidi invalid signature: ${respMsg}`);
        }
        if (respCode === 'DOUBLE_REQUEST_ID') {
          throw new Error(`Gidi DOUBLE_REQUEST_ID: ${respMsg || 'Double Request Id'}`);
        }
        throw new Error(`Gidi non-success response ${respCode}: ${respMsg}`);
      }

      const normalized = normalizeGidiResponse(rawResponse);
      if (!normalized.qrPayload) {
        throw new Error(
          `Gidi response missing qrPayload/rawData. response was: ${JSON.stringify(rawResponse)}`
        );
      }

      return {
        status: 'ready',
        result: {
          qrPayload: normalized.qrPayload,
          expiredTs: normalized.expiredTs,
          checkoutUrl: normalized.checkoutUrl,
          raw: rawResponse,
        },
      };
    } catch (err) {
      lastErr = err as AxiosError;

      const responseData: any = lastErr.response?.data || {};
      const respCodeCheck = String(responseData?.responseCode || '').toUpperCase();
      if (respCodeCheck === 'DOUBLE_REQUEST_ID' || /DOUBLE_REQUEST_ID/i.test(lastErr.message || '')) {
        console.error(`[Gidi][generateDynamicQris] abort due to DOUBLE_REQUEST_ID for ${t}`);
        throw new Error(
          `Gidi DOUBLE_REQUEST_ID: ${responseData?.responseMessage || lastErr.message || 'Double Request Id'}`
        );
      }

      let respMsg = '';
      let respCode = '';
      if (lastErr.response?.data) {
        const d: any = lastErr.response.data;
        respCode = String(d.responseCode || '');
        if (d.responseMessage) {
          respMsg =
            typeof d.responseMessage === 'object'
              ? JSON.stringify(d.responseMessage)
              : d.responseMessage;
        } else if (d.message) {
          respMsg = d.message;
        } else {
          respMsg = JSON.stringify(d);
        }
      } else {
        respMsg = lastErr.message;
      }

      console.error(
        `[Gidi][generateDynamicQris] attempt #${attempt + 1} failed for ${t} responseCode=${respCode} responseMessage=${respMsg}`
      );

      if (attempt >= maxRetries) break;
      await sleep(200 * Math.pow(2, attempt));
      attempt += 1;
    }
  }

  const fallbackMsg =
    lastErr?.response?.data || lastErr?.message || 'unknown error from GIDI';
  throw new Error(`generateDynamicQris failed for ${transactionId}: ${JSON.stringify(fallbackMsg)}`);
}

export async function generateDynamicQrisWithAutoPoll(
  config: GidiConfig,
  params: GenerateDynamicQrisParams,
  opts?: { maxTotalMs?: number; baseDelayMs?: number }
): Promise<GidiQrisResult> {
  const maxTotalMs = opts?.maxTotalMs ?? 3000;
  const baseDelayMs = opts?.baseDelayMs ?? 300;
  const start = Date.now();

  let outcome = await generateDynamicQris(config, params);
  if (outcome.status === 'ready') {
    return outcome.result;
  }
  if (outcome.status === 'pending') {
    let attempt = 0;
    while (Date.now() - start < maxTotalMs) {
      attempt += 1;
      await sleep(baseDelayMs * attempt);
      outcome = await generateDynamicQris(
        {
          ...config,
          requestId: outcome.pendingInfo.requestId,
          transactionId: outcome.pendingInfo.transactionId,
        },
        params
      );
      if (outcome.status === 'ready') {
        return outcome.result;
      }
    }
    throw new Error('Timeout waiting for Gidi QR to become ready (still pending).');
  }
  throw new Error('Unexpected outcome from generateDynamicQris');
}

export async function generateDynamicQrisFinal(
  baseConfig: Omit<GidiConfig, 'requestId' | 'transactionId'>,
  params: GenerateDynamicQrisParams,
  opts?: {
    maxFallbacks?: number;
    autoPoll?: boolean;
  }
): Promise<GidiQrisResult> {
  const maxFallbacks = opts?.maxFallbacks ?? 2;
  let fallbackCount = 0;
  while (true) {
    const requestId = generateRequestId();
    const transactionId = generateRequestId();
    const config: GidiConfig = {
      ...baseConfig,
      requestId,
      transactionId,
    };

    try {
      const result = opts?.autoPoll
        ? await generateDynamicQrisWithAutoPoll(config, params)
        : await (async () => {
            const outcome = await generateDynamicQris(config, params);
            if (outcome.status === 'ready') return outcome.result;
            if (outcome.status === 'pending') {
              throw new Error('Gidi returned pending (no autoPoll).');
            }
            throw new Error('Unexpected outcome.');
          })();

      return result;
    } catch (e: any) {
      const msg = String(e.message || '');
      if (/DOUBLE_REQUEST_ID/i.test(msg) && fallbackCount < maxFallbacks) {
        fallbackCount += 1;
        console.warn(
          `[Gidi][generateDynamicQrisFinal] got DOUBLE_REQUEST_ID, regenerating ids and retrying fallback #${fallbackCount}`
        );
        continue;
      }
      throw e;
    }
  }
}

/**
 * Tunggu sampai qrPayload tersedia, kalau timeout fallback ke checkoutUrl.
 */
export async function fetchReadyQr(
  baseConfig: Omit<GidiConfig, 'requestId' | 'transactionId'>,
  params: GenerateDynamicQrisParams,
  opts?: {
    totalTimeoutMs?: number;
    baseDelayMs?: number;
  }
): Promise<{
  qrContent: string;
  usedCheckoutUrl: boolean;
  raw: any;
}> {
  const totalTimeoutMs = opts?.totalTimeoutMs ?? 3000;
  const baseDelayMs = opts?.baseDelayMs ?? 300;
  const start = Date.now();

  const requestId = generateRequestId();
  const transactionId = generateRequestId();
  const config: GidiConfig = {
    ...baseConfig,
    requestId,
    transactionId,
  };

  let outcome = await generateDynamicQris(config, params);
  if (outcome.status === 'ready') {
    const result = outcome.result;
    return {
      qrContent: result.qrPayload || result.checkoutUrl || '',
      usedCheckoutUrl: !Boolean(result.qrPayload),
      raw: result.raw,
    };
  }

  while (Date.now() - start < totalTimeoutMs) {
    await sleep(baseDelayMs * (Math.floor((Date.now() - start) / baseDelayMs) + 1));
    outcome = await generateDynamicQris(
      {
        ...config,
        requestId,
        transactionId,
      },
      params
    );
    if (outcome.status === 'ready') {
      const result = outcome.result;
      return {
        qrContent: result.qrPayload || result.checkoutUrl || '',
        usedCheckoutUrl: !Boolean(result.qrPayload),
        raw: result.raw,
      };
    }
  }

  // fallback
  const finalResult = await generateDynamicQrisFinal(baseConfig, params, {
    autoPoll: false,
    maxFallbacks: 1,
  });
  return {
    qrContent: finalResult.qrPayload || finalResult.checkoutUrl || '',
    usedCheckoutUrl: !Boolean(finalResult.qrPayload),
    raw: finalResult.raw,
  };
}

/**
 * QR helpers
 */
export async function makeQrSvg(content: string): Promise<string> {
  return QRCode.toString(content, { type: 'svg' });
}

export async function makeQrDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content);
}
