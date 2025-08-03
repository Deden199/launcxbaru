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
  datetimeExpired?: string; // "YYYY-MM-DD HH:mm:ss" or ISO depending doc (use their format if specified)
}

export interface GidiQrisResult {
  qrPayload: string;
  expiredTs?: string;
  checkoutUrl?: string;
  raw?: any;
}

/**
 * compute signature for generateDynamic / queryDynamic:
 * sha256(merchantId + sha256(requestId + transactionId + credentialKey))
 * :contentReference[oaicite:14]{index=14} :contentReference[oaicite:15]{index=15}
 */
function computeDynamicSignature(
  merchantId: string,
  requestId: string,
  transactionId: string,
  credentialKey: string
): string {
  const inner = crypto
    .createHash('sha256')
    .update(`${requestId}${transactionId}${credentialKey}`)
    .digest('hex')
    .toLowerCase();
  return crypto
    .createHash('sha256')
    .update(`${merchantId}${inner}`)
    .digest('hex')
    .toLowerCase();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate Dynamic QRIS MPM
 * Follows documented endpoint and signature. :contentReference[oaicite:16]{index=16}
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

  const signature = computeDynamicSignature(
    config.merchantId,
    config.requestId,
    config.transactionId,
    config.credentialKey
  );

  const body: Record<string, any> = {
    merchantId: config.merchantId,
    subMerchantId: config.subMerchantId,
    requestId: config.requestId,
    transactionId: config.transactionId,
    amount: params.amount,
    signature,
  };
  if (params.datetimeExpired) {
    body.datetimeExpired = params.datetimeExpired;
  }

  const maxRetries = 2;
  let attempt = 0;
  let lastErr: any = null;

  while (attempt <= maxRetries) {
    try {
      const res = await client.post('/QrisMpm/generateDynamic', body);
      const data = res.data?.data || res.data || {};

      return {
        qrPayload:
          data.qrString ||
          data.qr_string ||
          data.qr_payload ||
          data.qrPayload ||
          '',
        expiredTs:
          data.expiredTs ||
          data.expired_ts ||
          data.expiration_time ||
          undefined,
        checkoutUrl:
          data.checkoutUrl || data.checkout_url || undefined,
        raw: res.data,
      };
    } catch (err) {
      lastErr = err as AxiosError;
      const status = lastErr.response?.status || null;
      const isRetryable =
        !status || (status >= 500 && status < 600) || status === 429;

      console.error(
        `[SettlementCron] generateDynamicQris for ${config.transactionId} attempt #${
          attempt + 1
        } failed: ${lastErr.message} status=${status} signature=${signature}`
      );

      if (!isRetryable) break;

      if (status === 429) {
        if (attempt === maxRetries) break;
        await sleep(500);
      } else {
        const backoff = 200 * Math.pow(2, attempt);
        await sleep(backoff);
      }

      attempt += 1;
    }
  }

  const msg =
    lastErr?.response?.data || lastErr?.message || 'unknown error from GIDI';
  throw new Error(
    `generateDynamicQris failed for ${config.transactionId}: ${JSON.stringify(
      msg
    )}`
  );
}

/**
 * Verify Notification (callback) signature for QRIS MPM.
 * Formula per doc:
 * sha256(merchantId + sha256(subMerchantId + channelType + invoiceNo + transactionId +
 * datetimePayment + amount + mdr + fee + isSettlementRealtime + settlementDate + credentialKey))
 * fileciteturn2file3L81-L85:contentReference[oaicite:17]{index=17}
 */
export function verifyGidiQrisMpmCallbackSignature(
  payload: any
): boolean {
  const {
    merchantId,
    subMerchantId,
    channelType,
    invoiceNo,
    transactionId,
    datetimePayment,
    amount,
    mdr,
    fee,
    isSettlementRealtime,
    settlementDate,
    signature: receivedSig,
  } = payload;

  if (
    !merchantId ||
    !subMerchantId ||
    !channelType ||
    !invoiceNo ||
    !transactionId ||
    datetimePayment == null ||
    amount == null ||
    mdr == null ||
    fee == null ||
    isSettlementRealtime == null ||
    settlementDate == null ||
    !payload.credentialKey
  ) {
    return false; // missing required pieces
  }

  // inner concatenation order per doc, no delimiters
  const innerRaw = `${subMerchantId}${channelType}${invoiceNo}${transactionId}${datetimePayment}${amount}${mdr}${fee}${isSettlementRealtime}${settlementDate}${payload.credentialKey}`;
  const innerHash = crypto
    .createHash('sha256')
    .update(innerRaw)
    .digest('hex')
    .toLowerCase();
  const expected = crypto
    .createHash('sha256')
    .update(`${merchantId}${innerHash}`)
    .digest('hex')
    .toLowerCase();

  // for debugging mismatches, caller can log both expected and received
  return expected === (receivedSig || '').toLowerCase();
}
