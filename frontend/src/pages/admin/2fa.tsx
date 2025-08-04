'use client'

import { useEffect, useState, FormEvent } from 'react'
import { useRequireAuth } from '@/hooks/useAuth'
import api from '@/lib/api'
import QRCode from 'qrcode'
import { Shield, CheckCircle, AlertCircle } from 'lucide-react'
import styles from './TwoFaPage.module.css'

export default function AdminTwoFaPage() {
  useRequireAuth()
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [qr, setQr] = useState('')
  const [otp, setOtp] = useState('')
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.get('/admin/2fa/status')
        setEnabled(res.data.totpEnabled)
      } catch {}
      finally { setLoading(false) }
    }
    fetchStatus()
  }, [])

  const setup = async () => {
    try {
      const { data } = await api.post('/admin/2fa/setup')
      const svg = await QRCode.toDataURL(data.otpauthUrl)
      setQr(svg)
      setMsg('Scan the QR code and enter the next OTP')
      setIsError(false)
    } catch {
      setMsg('Failed to set up 2FA')
      setIsError(true)
    }
  }

  const enable = async () => {
    try {
      await api.post('/admin/2fa/enable', { code: otp })
      setMsg('2FA enabled successfully')
      setIsError(false)
      setEnabled(true)
      setQr('')
      setOtp('')
    } catch {
      setMsg('Invalid OTP')
      setIsError(true)
    }
  }

  const regenerate = async () => {
    setEnabled(false)
    await setup()
    setMsg('New 2FA secret generated, please scan the QR again')
    setIsError(false)
  }

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await enable()
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.header}>
          <Shield size={28} className={styles.icon} />
          <h1 className={styles.title}>Two-Factor Authentication</h1>
        </div>
        {loading ? (
          <p>Loading 2FA status…</p>
        ) : enabled ? (
          <button onClick={regenerate} className={styles.button}>Regenerate 2FA</button>
        ) : qr ? (
          <form autoComplete="off" onSubmit={handleVerify}>
            <input type="text" name="username" autoComplete="username" style={{display:'none'}} />
            <input type="password" name="new-password" autoComplete="new-password" style={{display:'none'}} />
            <img src={qr} alt="QR Code" className={styles.qrImage} />
            <div className={`${styles.field} ${styles.twoFaField}`}>
              <input
                type="text"
                name="otp"
                autoComplete="off"
                placeholder="Enter 2FA code"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]{6}"
                className={styles.input}
              />
              <button type="submit" className={styles.button}>Verify OTP</button>
            </div>
          </form>
        ) : (
          <button onClick={setup} className={styles.button}>Setup 2FA</button>
        )}
        {msg && (
          <div className={styles.messageWrapper}>
            {isError ? (
              <AlertCircle size={20} className={styles.errorIcon} />
            ) : (
              <CheckCircle size={20} className={styles.successIcon} />
            )}
            <span className={`${styles.message} ${isError ? styles.error : styles.success}`}>{msg}</span>
          </div>
        )}
      </div>
    </div>
  )
}