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
  datetimeExpired?: string; // "YYYY-MM-DD HH:mm:ss" or ISO depending doc
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
 * Generate Dynamic QRIS MPM
 * Signature per doc: sha256(merchantId + sha256(requestId + transactionId + credentialKey))
 * Fallback: try uppercase variant if lowercase rejected with INVALID_SIGNATURE.
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

  // coercion & validation: API expects numeric merchantId / subMerchantId
  const merchantIdInt = parseInt(config.merchantId, 10);
  if (isNaN(merchantIdInt)) {
    throw new Error(`Invalid Gidi merchantId, must be integer-like: ${config.merchantId}`);
  }
  const subMerchantIdInt = parseInt(config.subMerchantId, 10);
  if (isNaN(subMerchantIdInt)) {
    throw new Error(`Invalid Gidi subMerchantId, must be integer-like: ${config.subMerchantId}`);
  }

  // prepare and trim inputs
  const clean = (s: string) => String(s).trim();
  const m = clean(config.merchantId);
  const r = clean(config.requestId);
  const t = clean(config.transactionId);
  const k = clean(config.credentialKey);

  // compute canonical signature (lowercase)
  const innerRaw = `${r}${t}${k}`;
  const innerHash = crypto.createHash('sha256').update(innerRaw, 'utf8').digest('hex'); // lowercase
  const outerRaw = `${m}${innerHash}`;
  const signatureLower = crypto.createHash('sha256').update(outerRaw, 'utf8').digest('hex'); // lowercase
  const signatureUpper = signatureLower.toUpperCase(); // fallback

  // debug breakdown (always log)
  console.debug('[Gidi][generateDynamicQris] signature components', {
    requestId: r,
    transactionId: t,
    credentialKeySnippet: k.slice(0, 6) + '…',
    innerRaw,
    innerHash,
    outerRaw,
    signatureLower,
    signatureUpper,
    merchantIdSentInBody: merchantIdInt,
    subMerchantIdSentInBody: subMerchantIdInt,
    amount: params.amount,
    datetimeExpired: params.datetimeExpired,
  });

  const maxRetries = 2;
  let attempt = 0;
  let lastErr: any = null;
  let triedUpper = false;

  while (attempt <= maxRetries) {
    // try lowercase first
    for (const sig of [signatureLower, signatureUpper]) {
      // if uppercase already tried and it wasn’t due to invalid signature, skip
      if (sig === signatureUpper && triedUpper && attempt === 0) {
        continue;
      }

      const body: Record<string, any> = {
        merchantId: merchantIdInt,
        subMerchantId: subMerchantIdInt,
        requestId: r,
        transactionId: t,
        amount: params.amount,
        signature: sig,
      };
      if (params.datetimeExpired) {
        body.datetimeExpired = params.datetimeExpired;
      }

      console.debug('[Gidi][generateDynamicQris] trying signature', {
        signature: sig,
        body: { ...body, signature: '[redacted]' },
      });

      try {
        const res = await client.post('/QrisMpm/generateDynamic', body);
        const rawResponse = res.data || {};
        const normalized = normalizeGidiResponse(rawResponse);

        if (!normalized.qrPayload) {
          console.error(
            `[Gidi][generateDynamicQris] Missing qrPayload for transactionId=${config.transactionId}. Full response:`,
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
          const d = lastErr.response.data;
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
          `[Gidi][generateDynamicQris] signature attempt failed for ${config.transactionId} signature=${sig} status=${status} responseCode=${respCode} responseMessage=${respMsg}`
        );

        const isInvalidSignature =
          respMsg.toLowerCase().includes('invalid signature') ||
          respCode.toUpperCase() === 'INVALID_SIGNATURE';
        const isRetryable =
          !status || (status >= 500 && status < 600) || status === 429;

        if (sig === signatureLower && isInvalidSignature) {
          // mark to allow trying uppercase fallback next
          triedUpper = true;
          continue; // try uppercase
        }

        if (!isRetryable && !(sig === signatureLower && isInvalidSignature)) {
          // unrecoverable non-signature error
          break;
        }

        // if was invalid signature on uppercase or retryable server error, will loop
      }
    }

    if (attempt >= maxRetries) break;
    const backoff = 200 * Math.pow(2, attempt);
    await sleep(backoff);
    attempt += 1;
  }

  const msg =
    lastErr?.response?.data || lastErr?.message || 'unknown error from GIDI';
  throw new Error(
    `generateDynamicQris failed for ${config.transactionId}: ${JSON.stringify(
      msg
    )}`
  );
}
