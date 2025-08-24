'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { X } from 'lucide-react'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [otpRequired, setOtpRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // restore persisted state
  useEffect(() => {
    const storedMsg = sessionStorage.getItem('loginMessage')
    const storedErr = sessionStorage.getItem('loginIsError')
    const storedOtpReq = sessionStorage.getItem('loginOtpRequired')
    if (storedMsg) {
      setMessage(storedMsg)
      setIsError(storedErr === 'true')
    }
    if (storedOtpReq === 'true') setOtpRequired(true)
  }, [])

  const showMessage = (msg: string, error = false) => {
    setMessage(msg)
    setIsError(error)
    sessionStorage.setItem('loginMessage', msg)
    sessionStorage.setItem('loginIsError', error ? 'true' : 'false')
  }
  const clearMessage = () => {
    setMessage('')
    setIsError(false)
    sessionStorage.removeItem('loginMessage')
    sessionStorage.removeItem('loginIsError')
  }
  const clearOtpFlag = () => {
    setOtpRequired(false)
    sessionStorage.removeItem('loginOtpRequired')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      const payload: any = {
        email: email.trim().toLowerCase(),
        password,
      }
      if (otpRequired) payload.otp = otp.trim()

      const { data } = await apiClient.post('/client/login', payload)

      clearMessage()
      clearOtpFlag()
      localStorage.setItem('clientToken', data.token)
      router.push('/client/dashboard')
    } catch (err: any) {
      const res = err?.response
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

  return (
    // paksa dark mode di halaman login
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/70 p-6 shadow-xl">
        <h1 className="mb-5 text-center text-xl font-semibold tracking-tight">
          Launcx Client Dashboard v2.0 Login
        </h1>

        {message && (
          <div
            role="alert"
            aria-live="polite"
            className={[
              'mb-4 flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-sm',
              isError
                ? 'border-rose-900/40 bg-rose-950/40 text-rose-300'
                : 'border-blue-900/40 bg-blue-950/40 text-blue-200',
            ].join(' ')}
          >
            <span className="pt-0.5">{message}</span>
            <button
              type="button"
              onClick={clearMessage}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-transparent hover:bg-white/5"
              aria-label="Dismiss message"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3" autoComplete="off">
          {/* dummy hidden fields to absorb Chrome prompts */}
          <input type="text" name="fakeuser" className="hidden" />
          <input type="password" name="fakepass" className="hidden" />

          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Email</span>
            <input
              name="username"
              type="email"
              placeholder="you@example.com"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full h-11 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none ring-0 placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Password</span>
            <input
              name="current-password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full h-11 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none ring-0 placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>

          {otpRequired && (
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">
                Authenticator Code
              </span>
              <input
                name="totp"
                type="text"
                inputMode="numeric"
                placeholder="6-digit code"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                className="w-full h-11 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none ring-0 placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
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
