import { useState } from 'react'
import api from '@/lib/api'

import styles from './AdminAuth.module.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [otp, setOtp] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    if (loading) return
    setLoading(true)
    setError('')
    e.preventDefault()
    try {
      const payload: any = { email, password }
      if (otpRequired) payload.otp = otp

      const res = await api.post('/auth/login', payload)
      const token = res.data.result.access_token
      localStorage.setItem('token', token)
      window.location.href = '/dashboard'
    } catch (err: any) {
      const msg = err.response?.data?.error
      if (err.response?.status === 400 && msg === 'OTP wajib diisi') {
        setOtpRequired(true)
        setError('Please enter the code from your Authenticator app.')
      } else {
        setError(msg || 'Login gagal')
      }
    } finally {
      setLoading(false)    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* Bisa tambahkan logo di sini */}
        <h1 className={styles.title}>Admin Dashboard</h1>
        {error && <div className={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className={styles.input}
            />
          </div>
          {otpRequired && (
            <div className={styles.field}>
              <label className={styles.label}>Authenticator Code</label>
              <input
                type="text"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                required
                className={styles.input}
                autoComplete="one-time-code"
              />
            </div>
          )}
          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? (otpRequired ? 'Verifying...' : 'Signing In...') : otpRequired ? 'Verify Code' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}