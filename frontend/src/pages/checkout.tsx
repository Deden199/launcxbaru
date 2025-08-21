import { useState } from 'react'
import axios from 'axios'
import JSEncrypt from 'jsencrypt'

import styles from './AdminAuth.module.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL

type CaptureMethod = 'automatic' | 'manual'
type ThreeDsMethod = 'CHALLENGE' | 'AUTO'

function toPemIfNeeded(key: string): string {
  // Kalau sudah PEM, return apa adanya
  if (key.includes('BEGIN PUBLIC KEY')) return key
  // Wrap base64/key pendek ke PEM (pecah tiap 64 char biar valid)
  const chunk = (s: string, n = 64) => s.match(new RegExp(`.{1,${n}}`, 'g'))?.join('\n') || s
  const body = chunk(key.replace(/[\r\n\s]/g, ''))
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`
}

export default function CheckoutPage() {
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')    // format: MM/YY
  const [cvv, setCvv] = useState('')
  const [amount, setAmount] = useState('')

  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('automatic')
  const [threeDsMethod, setThreeDsMethod] = useState<ThreeDsMethod>('CHALLENGE')

  const [sessionId, setSessionId] = useState('')
  const [encryptionKey, setEncryptionKey] = useState('')

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const validate = () => {
    const panOk = /^\d{12,19}$/.test(cardNumber.replace(/\s+/g, ''))
    const expOk = /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)
    const cvvOk = /^\d{3,4}$/.test(cvv)
    const amtOk = Number(amount) > 0
    if (!panOk) return 'Invalid card number'
    if (!expOk) return 'Invalid expiry (MM/YY)'
    if (!cvvOk) return 'Invalid CVV'
    if (!amtOk) return 'Amount must be > 0'
    return ''
  }

  const ensureSession = async () => {
    // Buat Payment Session sesuai dok:
    // amount: { value, currency }, paymentMethod.type=CARD, autoConfirm=false
    // sertakan minimal customer + orderInformation
    const payload = {
      amount: { value: Number(amount), currency: 'IDR' },
      customer: {
        email: 'customer@example.com',
        phoneNumber: { countryCode: '+62', number: '8120000000' },
      },
      orderInformation: {
        productDetails: [
          {
            type: 'PHYSICAL',
            category: 'GENERAL',
            subCategory: 'GENERAL',
            name: 'Order',
            description: 'Card payment',
            quantity: 1,
            price: { value: Number(amount), currency: 'IDR' },
          },
        ],
      },
      // opsi tambahan? boleh tambahkan statementDescriptor/expiryAt/metadata di sini
    }

    const res = await axios.post(`${API_URL}/v2/payments/session`, payload)
    setSessionId(res.data.id)
    setEncryptionKey(res.data.encryptionKey)
    return res.data
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = validate()
    if (v) {
      setError(v)
      return
    }

    setBusy(true)
    setError('')
    try {
      // Pastikan session sudah ada (dan gunakan amount yang diinput user)
      if (!sessionId || !encryptionKey) {
        await ensureSession()
      }

      const pemKey = toPemIfNeeded(encryptionKey || '')
      const encryptor = new JSEncrypt()
      encryptor.setPublicKey(pemKey)

      // HANYA data kartu yang dienkripsi (sesuai dok)
      const payload = JSON.stringify({
        cardNumber: cardNumber.replace(/\s+/g, ''),
        expiry, // MM/YY
        cvv,
      })

      const encryptedCard = encryptor.encrypt(payload)
      if (!encryptedCard) throw new Error('Encryption failed')

      // Kirim confirm sesuai dok
      const res = await axios.post(
        `${API_URL}/v2/payments/${sessionId}/confirm`,
        {
          encryptedCard,
          paymentMethodOptions: {
            card: {
              captureMethod,   // 'automatic' | 'manual'
              threeDsMethod,   // 'CHALLENGE' | 'AUTO'
              // processingConfig bisa ditambahkan bila perlu
            },
          },
        }
      )

      const { paymentUrl } = res.data
      if (paymentUrl) {
        window.location.href = paymentUrl
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.providerError ||
        err?.response?.data?.error ||
        err?.message ||
        'Payment failed'
      setError(msg)
      if (msg.toLowerCase().includes('session')) {
        setSessionId('')
        setEncryptionKey('')
      }
    } finally {
      setBusy(false)
    }
  }

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
  )
}

CheckoutPage.disableLayout = true
