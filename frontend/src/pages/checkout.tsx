"use client";

import { useState } from 'react';
import axios from 'axios';
import styles from './AdminAuth.module.css';
import { normalizeToBase64Spki, encryptHybrid } from '@/utils/hybrid-encryption';

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const DEMO_BUYER_ID = 'b1';
const DEMO_SUBMERCHANT_ID = 's1';

type CaptureMethod = 'automatic' | 'manual';
type ThreeDsMethod = 'CHALLENGE' | 'AUTO';

export default function CheckoutPage() {
  const [cardNumber, setCardNumber] = useState('');
  const [nameOnCard, setNameOnCard] = useState('');
  const [expiry, setExpiry] = useState(''); // MM/YY
  const [cvv, setCvv] = useState('');
  const [amount, setAmount] = useState('');

  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('automatic');
  const [threeDsMethod, setThreeDsMethod] = useState<ThreeDsMethod>('CHALLENGE');

  const [sessionId, setSessionId] = useState('');
  const [encryptionKey, setEncryptionKey] = useState(''); // base64 SPKI atau PEM dari backend

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const validate = () => {
    const panOk = /^\d{12,19}$/.test(cardNumber.replace(/\s+/g, ''));
    const expOk = /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry);
    const cvvOk = /^\d{3,4}$/.test(cvv);
    const amtOk = Number(amount) > 0;
    if (!panOk) return 'Invalid card number';
    if (!expOk) return 'Invalid expiry (MM/YY)';
    if (!cvvOk) return 'Invalid CVV';
    if (!amtOk) return 'Amount must be > 0';
    return '';
  };

 // SELALU buat session baru (fresh) setiap dipanggil
const ensureSession = async () => {
  const res = await axios.post(`${API_URL}/payments/session`, {
    amount: { value: Number(amount), currency: 'IDR' },
    buyerId: DEMO_BUYER_ID,
    subMerchantId: DEMO_SUBMERCHANT_ID,
  });

  // backend sekarang memastikan { id, encryptionKey } sudah normalized
  const { id, encryptionKey } = res.data || {};
  if (!id || !encryptionKey) throw new Error('Missing session id / encryptionKey');

  // simpan state
  setSessionId(id);
  setEncryptionKey(encryptionKey);
  return { id, encryptionKey };
};
// taruh di atas (dekat import/konstanta)
function extractPaymentUrl(d: any): string | null {
  if (!d || typeof d !== 'object') return null;
  const cands = [
    d.paymentUrl,
    d?.data?.paymentUrl,
    d?.result?.paymentUrl,
    d?.paymentSession?.paymentUrl,
    d.redirectUrl,
    d?.data?.redirectUrl,
    d?.nextAction?.url,
    d?.next_action?.url,
    d?.actions?.threeDs?.url,
    d?.payment?.paymentUrl,
    d?.links?.redirect,
  ];
  for (const v of cands) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');

  const v = validate();
  if (v) { setError(v); return; }

  setBusy(true);
  try {
    // 1) Selalu buat session BARU
    const { id, encryptionKey: ek } = await ensureSession();

    // 2) Normalisasi public key → base64 SPKI (DER)
    const base64Spki = normalizeToBase64Spki(ek);

    // 3) Payload kartu + device sesuai dok
    const [mm, yy] = expiry.split('/');
    const payload = {
      card: {
        number: cardNumber.replace(/\s+/g, ''),
        expiryMonth: (mm || '').padStart(2, '0'),
        expiryYear: yy || '',
        cvc: cvv,
        nameOnCard,
      },
      deviceInformations: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        country: 'ID', // minimum, boleh diperluas sesuai kebutuhan
      },
      metadata: {},
    };

    // 4) Enkripsi hybrid
    const encryptedCard = await encryptHybrid(JSON.stringify(payload), base64Spki);

    // 5) Confirm
    const res = await axios.post(`${API_URL}/payments/${id}/confirm`, {
      encryptedCard,
      paymentMethodOptions: {
        card: { captureMethod, threeDsMethod },
      },
    });

    // 6) Ambil 3DS URL dari berbagai kemungkinan field
    const data = res.data || {};
    const url = extractPaymentUrl(data);

    // Debug agar kelihatan bentuk respons sebenarnya
    // eslint-disable-next-line no-console
    console.log('[Confirm response]', data);

    if (url) {
      // Redirect ke halaman 3DS
      window.location.replace(url); // atau window.location.assign(url)
    } else {
      // Tidak ada URL di respons → tampilkan pesan yang berguna
      setError('Provider tidak mengembalikan paymentUrl / 3DS URL. Cek console untuk payload lengkap.');
    }
  } catch (err: any) {
    const status = err?.response?.status;
    const providerRaw = err?.response?.data;
    const msg =
      providerRaw?.provider?.message ||
      providerRaw?.error ||
      providerRaw?.message ||
      err?.message ||
      'Payment failed';

    if (
      status === 409 ||
      /cannot be confirmed/i.test(String(msg)) ||
      /not allowed to confirm/i.test(JSON.stringify(providerRaw || {}))
    ) {
      setSessionId('');
      setEncryptionKey('');
      setError('Session tidak bisa dikonfirmasi. Silakan klik Pay lagi untuk membuat sesi baru.');
    } else {
      setError(msg);
    }
  } finally {
    setBusy(false);
  }
};


  
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Checkout</h1>
        {error && <div className={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Card Number</label>
            <input
              type="text"
              value={cardNumber}
              onChange={e => setCardNumber(e.target.value)}
              required
              className={styles.input}
              inputMode="numeric"
              autoComplete="cc-number"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Name on Card</label>
            <input
              type="text"
              value={nameOnCard}
              onChange={e => setNameOnCard(e.target.value)}
              required
              className={styles.input}
              autoComplete="cc-name"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Expiry (MM/YY)</label>
            <input
              type="text"
              placeholder="MM/YY"
              value={expiry}
              onChange={e => setExpiry(e.target.value)}
              required
              className={styles.input}
              inputMode="numeric"
              autoComplete="cc-exp"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>CVV</label>
            <input
              type="password"
              value={cvv}
              onChange={e => setCvv(e.target.value)}
              required
              className={styles.input}
              inputMode="numeric"
              autoComplete="cc-csc"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Amount (IDR)</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
              className={styles.input}
              min={1}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Capture Method</label>
            <select
              value={captureMethod}
              onChange={e => setCaptureMethod(e.target.value as CaptureMethod)}
              className={styles.input}
            >
              <option value="automatic">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>3DS Method</label>
            <select
              value={threeDsMethod}
              onChange={e => setThreeDsMethod(e.target.value as ThreeDsMethod)}
              className={styles.input}
            >
              <option value="CHALLENGE">Challenge</option>
              <option value="AUTO">Auto</option>
            </select>
          </div>

          <button type="submit" className={styles.button} disabled={busy}>
            {busy ? 'Processing...' : 'Pay'}
          </button>
        </form>
      </div>
    </div>
  );
}

CheckoutPage.disableLayout = true;
