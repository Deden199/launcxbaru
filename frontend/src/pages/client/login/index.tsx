'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { X } from 'lucide-react'
import styles from './ClientAuth.module.css'

// LoginForm v2.0 – persist message across remounts via sessionStorage
export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [message, setMessage] = useState('')      
  const [isError, setIsError] = useState(false)   
  const [otpRequired, setOtpRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // On mount, restore any prior message
  useEffect(() => {
    const storedMsg = sessionStorage.getItem('loginMessage')
    const storedErr = sessionStorage.getItem('loginIsError')
    const storedOtpReq = sessionStorage.getItem('loginOtpRequired')
    if (storedMsg) {
      setMessage(storedMsg)
      setIsError(storedErr === 'true')
    }
    if (storedOtpReq === 'true') {
      setOtpRequired(true)
    }
  }, [])

  // Helper to set message + persist
  function showMessage(msg: string, error = false) {
    setMessage(msg)
    setIsError(error)
    sessionStorage.setItem('loginMessage', msg)
    sessionStorage.setItem('loginIsError', error ? 'true' : 'false')
  }
  function clearMessage() {
    setMessage('')
    setIsError(false)
    sessionStorage.removeItem('loginMessage')
    sessionStorage.removeItem('loginIsError')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)

    try {
      const payload: any = { email, password }
      if (otpRequired) payload.otp = otp

      const { data } = await apiClient.post('/client/login', payload)

      // on success: clear both state and storage, then redirect
      clearMessage()
      localStorage.setItem('clientToken', data.token)
      router.push('/client/dashboard')

    } catch (err: any) {
      const res = err.response
      const msg = res?.data?.error || ''

      if (res?.status === 400 && msg === 'OTP wajib diisi') {
        setOtpRequired(true)
        sessionStorage.setItem('loginOtpRequired', 'true')
        showMessage('Please enter the code from your Authenticator app.', false)
      } else if (res?.status === 401) {
        showMessage(
          msg === 'OTP tidak valid'
            ? 'Invalid authenticator code'
            : 'Invalid email or password',
          true
        )
      } else if (res?.status === 400) {
        showMessage(msg || 'Invalid request data.', true)
      } else {
        showMessage('Something went wrong. Please try again later.', true)
      }
    } finally {
      setLoading(false)
    }
  }

  const dismiss = () => clearMessage()

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Client Dashboard v1.2 Login</h1>

        {message && (
          <div className={isError ? styles.error : styles.info}>
            <span>{message}</span>
            <button type="button" onClick={dismiss} className={styles.closeButton}>
              <X size={16} />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form} autoComplete="off">
          {/* dummy hidden fields to absorb Chrome prompts */}
          <input type="text" name="fakeuser" style={{ display: 'none' }} />
          <input type="password" name="fakepass" style={{ display: 'none' }} />

          <input
            name="username"
            className={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            autoComplete="username"
            onChange={e => setEmail(e.target.value)}
            required
          />

          <input
            name="current-password"
            className={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            autoComplete="current-password"
            onChange={e => setPassword(e.target.value)}
            required
          />

          {otpRequired && (
            <input
              name="totp"
              className={styles.input}
              type="text"
              placeholder="Authenticator Code"
              value={otp}
              autoComplete="one-time-code"
              onChange={e => setOtp(e.target.value)}
              required
            />
          )}

          <button type="submit" className={styles.button} disabled={loading}>
            {loading
              ? otpRequired
                ? 'Verifying...'
                : 'Logging in...'
              : otpRequired
                ? 'Verify Code'
                : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}
