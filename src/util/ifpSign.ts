import crypto from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

const PRIVATE_KEY = readFileSync(
  process.env.IFP_PRIV_PEM_PATH     || '/opt/ifp_keys/private_key.pem',
  'utf8'
);
const CLIENT_SECRET = process.env.IFP_CLIENT_SECRET!;

/** RSA-SHA256 → Base64, untuk getAccessToken */
export function signRsa(payload: string): string {
  return crypto
    .createSign('RSA-SHA256')
    .update(payload, 'utf8')
    .sign(PRIVATE_KEY, 'base64');
}

/** HMAC-SHA512 → Base64, untuk semua endpoint ber-token :contentReference[oaicite:0]{index=0}&#8203;:contentReference[oaicite:1]{index=1} */
export function signHmac(payload: string): string {
  return crypto
    .createHmac('sha512', CLIENT_SECRET)
    .update(payload, 'utf8')
    .digest('base64');
}

