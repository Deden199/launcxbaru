'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import styles from './ClientAuth.module.css'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)

  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    try {
      // kirim payload berdasarkan apakah OTP sudah diminta
      const payload: any = { email, password }
      if (otpRequired) payload.otp = otp

      const { data } = await apiClient.post('/client/login', payload)
      localStorage.setItem('clientToken', data.token)
      router.push('/client/dashboard')
    } catch (err: any) {
      const res = err.response
      const msg = res?.data?.error

      // 1) Backend bilang "OTP wajib diisi" → munculkan field OTP
      if (res?.status === 400 && msg === 'OTP wajib diisi') {
        setOtpRequired(true)
        setError('')          // hilangkan error lama
        return
      }

      // 2) Invalid credentials atau OTP tidak valid
      if (res?.status === 401) {
        // bisa disesuaikan: backend kirim "Invalid credentials" atau "OTP tidak valid"
        setError(msg === 'OTP tidak valid' ? 'OTP tidak valid' : 'Email atau password salah')
        return
      }

      // 3) fallback
      setError('Terjadi kesalahan, silakan coba lagi.')
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Client Login</h1>

        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            className={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />

          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          {otpRequired && (
            <input
              className={styles.input}
              type="number"
              placeholder="Kode OTP"
              value={otp}
              onChange={e => setOtp(e.target.value)}
              required
            />
          )}

          <button type="submit" className={styles.button}>
            {otpRequired ? 'Verifikasi OTP' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}
