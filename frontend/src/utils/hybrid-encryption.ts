// utils/hybrid-encryption.ts (FINAL)

/**
 * Normalisasi public key dari provider menjadi base64 SPKI (DER).
 * - Menerima PEM atau base64 raw (URL-safe juga boleh)
 * - Mengembalikan base64 standar dengan padding
 */
export function normalizeToBase64Spki(rawKey: string): string {
  if (!rawKey) throw new Error('Missing encryptionKey');
  let k = rawKey.trim();

  // Jika PEM → ambil body base64
  if (k.includes('BEGIN PUBLIC KEY') || k.includes('BEGIN RSA PUBLIC KEY')) {
    k = k
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '');
  } else {
    // Jika base64 raw → bersihkan whitespace + URL-safe → standar
    k = k.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  }

  // Pad sampai kelipatan 4
  const pad = (4 - (k.length % 4)) % 4;
  if (pad) k = k + '='.repeat(pad);
  return k;
}

/** Base64 → ArrayBuffer (browser) */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Pastikan Uint8Array */
function toUint8(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** ArrayBuffer/Uint8Array → base64 (browser) */
function arrayBufferToBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = toUint8(input);
  let out = '';
  for (let i = 0; i < bytes.byteLength; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

/**
 * Hybrid encrypt (RSA-OAEP(SHA-256) + AES-256-GCM).
 * Menghasilkan base64 dari JSON { encryptedKey, nonce, ciphertext } sesuai dok.
 *
 * @param plaintext string JSON kartu/device yang mau dienkripsi
 * @param base64PublicKey kunci publik SPKI (DER) dalam base64 (hasil normalizeToBase64Spki)
 * @returns string base64(JSON)
 */
export async function encryptHybrid(
  plaintext: string,
  base64PublicKey: string
): Promise<string> {
  // Hanya jalan di browser (Next: panggil dari client component)
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('WebCrypto SubtleCrypto is not available (client-side only)');
  }

  // 1) Import RSA public key (SPKI DER)
  const spkiBytes = base64ToArrayBuffer(base64PublicKey);
  const publicKey = await window.crypto.subtle.importKey(
    'spki',
    spkiBytes,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );

  // 2) Generate AES-256-GCM key + 12-byte nonce
  const aesKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  );
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));

  // 3) Encrypt plaintext dengan AES-GCM
  const ptBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    ptBytes
  );

  // 4) Export AES key (raw) lalu encrypt pakai RSA-OAEP
  const aesRaw = await window.crypto.subtle.exportKey('raw', aesKey);
  const encryptedKey = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    aesRaw
  );

  // 5) JSON { encryptedKey, nonce, ciphertext } → base64
  const payload = {
    encryptedKey: arrayBufferToBase64(encryptedKey), // ArrayBuffer
    nonce:       arrayBufferToBase64(nonce),         // Uint8Array
    ciphertext:  arrayBufferToBase64(ciphertext),    // ArrayBuffer
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload)); // Uint8Array
  return arrayBufferToBase64(jsonBytes); // base64(JSON)
}
