import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

// Read Gidi credentials from environment variables
const {
  GIDI_URL = '',
  GIDI_MERCHANT_ID = '',
  GIDI_SUB_MERCHANT_ID = '',
  GIDI_CREDENTIAL_KEY = '',
} = process.env;
function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Create a preconfigured Axios instance for Gidi API
 */
export function createAxiosInstance(): AxiosInstance {
  return axios.create({
    baseURL: GIDI_URL,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Normalize Axios errors to a simplified object
 */
export function normalizeAxiosError(err: any) {
  if (axios.isAxiosError(err)) {
    return {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

/**
 * Build signature string for generating dynamic QRIS.
 * Uses a nested SHA-256 hash as required by Gidi. */
export function buildGenerateDynamicSignature(
  invoiceId: string,
  amount: number
): string {
  const inner = sha256(
    `${GIDI_SUB_MERCHANT_ID}${invoiceId}${amount}${GIDI_CREDENTIAL_KEY}`
  );
  return sha256(`${GIDI_MERCHANT_ID}${inner}`);
}

/**
 * Build signature string for querying dynamic QRIS
 */
export function buildQueryDynamicSignature(invoiceId: string): string {
  const inner = sha256(
    `${GIDI_SUB_MERCHANT_ID}${invoiceId}${GIDI_CREDENTIAL_KEY}`
  );
  return sha256(`${GIDI_MERCHANT_ID}${inner}`);
}

/**
 * Generate a dynamic QRIS from Gidi
 */
export async function generateDynamicQris(
  invoiceId: string,
  amount: number
): Promise<any> {
  const client = createAxiosInstance();
  const signature = buildGenerateDynamicSignature(invoiceId, amount);

  const res = await client.post(
    '/qris/v1/dynamic',
    {
      merchant_id: GIDI_MERCHANT_ID,
      sub_merchant_id: GIDI_SUB_MERCHANT_ID,
      invoice_id: invoiceId,
      amount,
    },
    { headers: { 'X-Signature': signature } }
  );

  return res.data;
}

/**
 * Query a dynamic QRIS status from Gidi
 */
export async function queryDynamicQrisStatus(invoiceId: string): Promise<any> {
  const client = createAxiosInstance();
  const signature = buildQueryDynamicSignature(invoiceId);

  const res = await client.get(`/qris/v1/dynamic/${invoiceId}`, {
    headers: {
      'X-Signature': signature,
      'X-Merchant-Id': GIDI_MERCHANT_ID,
      'X-Sub-Merchant-Id': GIDI_SUB_MERCHANT_ID,
    },
  });

  return res.data;
}

/**
 * Wait for a transaction to reach settlement status by polling
 */
export async function waitForSettlement(
  invoiceId: string,
  intervalMs = 5000,
  maxAttempts = 12
): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await queryDynamicQrisStatus(invoiceId);
    const status = resp?.status || resp?.data?.status;
    if (status === 'SETTLED' || status === 'PAID') {
      return resp;
    }
    if (status === 'EXPIRED' || status === 'CANCELLED') {
      return resp;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Settlement wait timed out');
}

/**
 * Handle callback payload for QRIS MPM transactions
 */
export async function handleQrisMpmCallback(payload: any): Promise<any> {
  if (!verifyQrisMpmCallbackSignature(payload)) {
    throw new Error('Invalid callback signature');
  }
  return payload;
}

/**
 * Verify callback signature sent by Gidi for QRIS MPM
 */
export function verifyQrisMpmCallbackSignature(payload: any): boolean {
  const signature = payload?.signature || payload?.sign || '';
  const { invoiceId, amount, status } = payload;
  const inner = sha256(
    `${GIDI_SUB_MERCHANT_ID}${invoiceId}${amount}${status}${GIDI_CREDENTIAL_KEY}`
  );
  const expected = sha256(`${GIDI_MERCHANT_ID}${inner}`);
  return signature === expected;
}

export default {
  createAxiosInstance,
  normalizeAxiosError,
  buildGenerateDynamicSignature,
  buildQueryDynamicSignature,
  generateDynamicQris,
  queryDynamicQrisStatus,
  waitForSettlement,
  handleQrisMpmCallback,
  verifyQrisMpmCallbackSignature,
};
