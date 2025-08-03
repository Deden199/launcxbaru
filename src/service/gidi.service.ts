// gidi.service.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';

export interface GidiConfig {
  baseUrl: string;
  merchantId: string;        // numeric string per doc
  subMerchantId: string;     // numeric string
  requestId: string;         // unique per request
  transactionId: string;     // unique per request
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

/**
 * Normalize raw Gidi response into structured shape.
 */
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Signature sesuai screenshot terakhir:
 * sha256(merchantId + sha256(subMerchantId + requestId + transactionId + amount + credentialKey))
 */
export async function generateDynamicQris(
  config: GidiConfig,
  params: GenerateDynamicQrisParams
): Promise<GidiQrisResult> {
  const client: AxiosInstance = axios.create({
    baseURL: config.baseUrl,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 7000,
  });

  // Validasi numeric
  const merchantIdInt = parseInt(config.merchantId, 10);
  if (isNaN(merchantIdInt)) {
    throw new Error(`Invalid Gidi merchantId, must be integer-like: ${config.merchantId}`);
  }
  const subMerchantIdInt = parseInt(config.subMerchantId, 10);
  if (isNaN(subMerchantIdInt)) {
    throw new Error(`Invalid Gidi subMerchantId, must be integer-like: ${config.subMerchantId}`);
  }

  const clean = (s: string) => String(s).trim();
  const m = clean(config.merchantId);
  const s = clean(config.subMerchantId);
  const r = clean(config.requestId);
  const t = clean(config.transactionId);
  const k = clean(config.credentialKey);
  const amt = String(params.amount);

  // innerRaw = subMerchantId + requestId + transactionId + amount + credentialKey
  const innerRaw = `${s}${r}${t}${amt}${k}`;
  const innerHash = crypto.createHash('sha256').update(innerRaw, 'utf8').digest('hex'); // lowercase
  const outerRaw = `${m}${innerHash}`;
  const signature = crypto.createHash('sha256').update(outerRaw, 'utf8').digest('hex'); // lowercase

  // Logging untuk debugging
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
    merchantId: merchantIdInt,
    subMerchantId: subMerchantIdInt,
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
      const respCode = (rawResponse.responseCode || '').toString().toUpperCase();
      const respMsg = rawResponse.responseMessage || rawResponse.message || '';

      if (respCode === 'SERVICE_NOT_ALLOWED') {
        console.error('[Gidi][generateDynamicQris] SERVICE_NOT_ALLOWED', {
          transactionId: config.transactionId,
          respMsg,
        });
        throw new Error(`Gidi terminal error SERVICE_NOT_ALLOWED: ${respMsg}`);
      }

      if (respCode && respCode !== 'SUCCESS' && respCode !== '00') {
        console.error(
          `[Gidi][generateDynamicQris] non-success response for ${config.transactionId} responseCode=${respCode} responseMessage=${respMsg}`
        );
        // kalau signature invalid, jangan langsung throw, tapi anggap sebagai kegagalan (tidak retrying signature karena sudah sesuai spek)
        if (respCode === 'INVALID_SIGNATURE') {
          throw new Error(`Gidi invalid signature: ${respMsg}`);
        }
        throw new Error(`Gidi non-success response ${respCode}: ${respMsg}`);
      }

      const normalized = normalizeGidiResponse(rawResponse);
      if (!normalized.qrPayload) {
        console.error(
          `[Gidi][generateDynamicQris] Missing qrPayload for ${config.transactionId}. Full response:`,
          JSON.stringify(rawResponse)
        );
        throw new Error(
          `Gidi response missing qrPayload/rawData. response was: ${JSON.stringify(
            rawResponse
          )}`
        );
      }

      return {
        qrPayload: normalized.qrPayload,
        expiredTs: normalized.expiredTs,
        checkoutUrl: normalized.checkoutUrl,
        raw: rawResponse,
      };
    } catch (err) {
      lastErr = err as AxiosError;
      const status = lastErr.response?.status || null;

      let respMsg = '';
      let respCode = '';
      if (lastErr.response?.data) {
        const d: any = lastErr.response.data;
        respCode = (d.responseCode || '').toString();
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
        `[Gidi][generateDynamicQris] attempt #${attempt + 1} failed for ${config.transactionId} status=${status} responseCode=${respCode} responseMessage=${respMsg}`
      );

      if (attempt >= maxRetries) break;

      // backoff
      await sleep(200 * Math.pow(2, attempt));
      attempt += 1;
    }
  }

  const fallbackMsg =
    lastErr?.response?.data || lastErr?.message || 'unknown error from GIDI';
  throw new Error(
    `generateDynamicQris failed for ${config.transactionId}: ${JSON.stringify(
      fallbackMsg
    )}`
  );
}
