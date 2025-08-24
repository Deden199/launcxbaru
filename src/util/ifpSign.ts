// src/util/ifpSign.ts
import crypto from 'crypto';
import fs from 'fs';

const CONFIG = {
  pemPath: process.env.IFP_PRIV_PEM_PATH || '/opt/ifp_keys/private_key.pem',
  pemBase64: process.env.IFP_PRIV_PEM_BASE64, // optional: isi PEM yg di-base64
  clientSecret: process.env.IFP_CLIENT_SECRET,
};

let PRIVATE_KEY_CACHE: string | null | undefined; // undefined = belum dicoba

function loadPrivateKey(): string | null {
  if (PRIVATE_KEY_CACHE !== undefined) return PRIVATE_KEY_CACHE;

  // 1) Prefer base64 env (aman di container/PM2)
  if (CONFIG.pemBase64) {
    try {
      PRIVATE_KEY_CACHE = Buffer.from(CONFIG.pemBase64, 'base64').toString('utf8');
      return PRIVATE_KEY_CACHE;
    } catch (e) {
      console.warn('[IFP] Failed to decode IFP_PRIV_PEM_BASE64:', (e as Error).message);
    }
  }

  // 2) Fallback ke file path
  try {
    if (fs.existsSync(CONFIG.pemPath)) {
      PRIVATE_KEY_CACHE = fs.readFileSync(CONFIG.pemPath, 'utf8');
      return PRIVATE_KEY_CACHE;
    }
  } catch (e) {
    console.warn('[IFP] Error reading private key file:', (e as Error).message);
  }

  console.warn(
    `[IFP] Private key not found. Set IFP_PRIV_PEM_BASE64 atau pastikan file ada di: ${CONFIG.pemPath}`
  );
  PRIVATE_KEY_CACHE = null;
  return null;
}

/** Panggil ini di startup buat ngecek & log status, tapi tidak nge-crash server */
export function ensureIfpReady(): boolean {
  const hasKey = !!loadPrivateKey();
  const hasSecret = !!CONFIG.clientSecret;
  if (!hasKey || !hasSecret) {
    console.warn(
      '[IFP] disabled: missing secrets.',
      { hasKey, hasSecret }
    );
    return false;
  }
  return true;
}

/** RSA-SHA256 → Base64 (untuk getAccessToken) */
export function signRsa(payload: string): string {
  const key = loadPrivateKey();
  if (!key) throw new Error('[IFP] RSA signing called but private key is not configured');
  return crypto.createSign('RSA-SHA256').update(payload, 'utf8').sign(key, 'base64');
}

/** HMAC-SHA512 → Base64 (untuk endpoint ber-token) */
export function signHmac(payload: string): string {
  const secret = CONFIG.clientSecret;
  if (!secret) throw new Error('[IFP] HMAC signing called but IFP_CLIENT_SECRET is not configured');
  return crypto.createHmac('sha512', secret).update(payload, 'utf8').digest('base64');
}
