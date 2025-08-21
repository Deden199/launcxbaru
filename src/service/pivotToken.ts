// src/service/pivotToken.ts
import axios from 'axios';
import { config } from '../config';

type TokenState = {
  accessToken: string | null;
  // simpan epoch ms kapan token kadaluarsa (kasih buffer 30 detik biar aman)
  expiresAt: number;
};
const state: TokenState = { accessToken: null, expiresAt: 0 };

// minta token baru
async function requestNewToken(): Promise<TokenState> {
  const baseUrl = config.api.paymentApi?.baseUrl;
  const clientId = config.api.paymentApi?.apiKey;
  const clientSecret = config.api.paymentApi?.apiSecret;

  if (!baseUrl) throw new Error('PAYMENT_API_URL is not set');
  if (!clientId || !clientSecret) throw new Error('PAYMENT_API_KEY/SECRET is not set');

  const url = `${baseUrl.replace(/\/$/, '')}/v1/access-token`;
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
  if (!data?.accessToken || !data?.expiresIn) {
    throw new Error('Pivot token response invalid');
  }
  const now = Date.now();
  const ttlMs = Number(data.expiresIn) * 1000;
  // buffer 30 detik supaya nggak mepet expired
  state.accessToken = data.accessToken;
  state.expiresAt = now + ttlMs - 30_000;
  return { ...state };
}

// ambil token valid (refresh kalau expired)
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (state.accessToken && state.expiresAt > now) {
    return state.accessToken;
  }
  const t = await requestNewToken();
  return t.accessToken!;
}

// opsional: paksa refresh ketika 401
export async function refreshAccessToken(): Promise<string> {
  const t = await requestNewToken();
  return t.accessToken!;
}
