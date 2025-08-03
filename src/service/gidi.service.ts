import axios, { AxiosInstance } from 'axios';

export interface GidiConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface GidiQrisResult {
  qrPayload: string;
  expiredTs?: string;
  checkoutUrl?: string;
  raw?: any;
}

/**
 * Generate a dynamic QRIS code using Gidi's API
 */
export async function generateDynamicQris(
  config: GidiConfig,
  params: { amount: number; refId: string }
): Promise<GidiQrisResult> {
  const client: AxiosInstance = axios.create({
    baseURL: config.baseUrl,
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': config.clientId,
      'x-client-secret': config.clientSecret,
    },
  });

  const res = await client.post('/qris/dynamic', {
    amount: params.amount,
    ref_id: params.refId,
  });

  const data = res.data?.data || res.data || {};

  return {
    qrPayload: data.qrPayload || data.qr_string || data.qrString,
    expiredTs: data.expiredTs || data.expired_ts || data.expiration_time,
    checkoutUrl: data.checkoutUrl || data.checkout_url,
    raw: res.data,
  };
}