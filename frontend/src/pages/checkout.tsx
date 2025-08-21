import { useEffect, useState } from 'react'
import axios from 'axios'
import JSEncrypt from 'jsencrypt'

import styles from './AdminAuth.module.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL

export default function CheckoutPage() {
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [amount, setAmount] = useState('')

  const [sessionId, setSessionId] = useState('')
  const [encryptionKey, setEncryptionKey] = useState('')

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    axios
      .post(`${API_URL}/v2/payments/session`)
      .then(res => {
        setSessionId(res.data.id)
        setEncryptionKey(res.data.encryptionKey)
      })
      .catch(err => {
        setError(err.response?.data?.error || 'Failed to start session')
      })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionId || !encryptionKey || busy) return

    setBusy(true)
    setError('')
    try {
      const encryptor = new JSEncrypt()
      encryptor.setPublicKey(encryptionKey)

      const payload = JSON.stringify({
        cardNumber,
        expiry,
        cvv,
        amount: Number(amount)
      })

      const encryptedCard = encryptor.encrypt(payload)
      if (!encryptedCard) throw new Error('Encryption failed')

      const res = await axios.post(
        `${API_URL}/v2/payments/${sessionId}/confirm`,
        { encryptedCard }
      )

      const { paymentUrl } = res.data
      if (paymentUrl) {
        window.location.href = paymentUrl
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Payment failed'
      setError(msg)
      if (msg.toLowerCase().includes('session')) {
        setSessionId('')
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
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Expiry</label>
            <input
              type="text"
              placeholder="MM/YY"
              value={expiry}
              onChange={e => setExpiry(e.target.value)}
              required
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>CVV</label>
            <input
              type="text"
              value={cvv}
              onChange={e => setCvv(e.target.value)}
              required
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Amount</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
              className={styles.input}
            />
          </div>
          <button type="submit" className={styles.button} disabled={busy || !sessionId}>
            {busy ? 'Processing...' : 'Pay'}
          </button>
        </form>
      </div>
    </div>
  )
}

CheckoutPage.disableLayout = true

