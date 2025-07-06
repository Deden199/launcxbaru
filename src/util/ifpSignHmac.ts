import crypto from 'crypto';

/**
 * Signature Senmo production (HMAC-SHA512).
 * @param stringToSign "<METHOD>:<PATH>:<accessToken>:<payloadHex>:<timestamp>"
 * @param secret       client-secret production
 */
export function hmacSign(stringToSign: string, secret: string): string {
  return crypto
    .createHmac('sha512', secret)
    .update(stringToSign)
    .digest('base64');
}

