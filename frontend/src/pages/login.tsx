'use client'

import { useState } from 'react'
import api from '@/lib/api'
import { Mail, Lock, ShieldCheck, Eye, EyeOff, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [otp, setOtp] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')

    try {
      const payload: any = { email, password }
      if (otpRequired) payload.otp = otp

      const res = await api.post('/auth/login', payload)
      const token = res.data.result.access_token
      localStorage.setItem('token', token)
      // redirect
      window.location.href = '/dashboard'
    } catch (err: any) {
      const msg = err?.response?.data?.error
      if (err?.response?.status === 400 && msg === 'OTP wajib diisi') {
        setOtpRequired(true)
        setError('Please enter the code from your Authenticator app.')
      } else {
        setError(msg || 'Login gagal')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-950 to-black text-neutral-100">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
        {/* Brand / Logo */}
        <div className="mb-6 flex items-center gap-3">
          <div className="inline-grid h-10 w-10 place-items-center rounded-xl border border-neutral-800 bg-neutral-900 shadow">
            <span className="text-lg">🛠️</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Launcx Admin Dashboard v2.0</h1>
            <p className="text-xs text-neutral-400">Sign in to manage Launcx</p>
          </div>
        </div>

        {/* Card */}
        <div className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          {error && (
            <div className="mb-4 rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Email</label>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 pl-9 pr-3 text-sm outline-none ring-offset-0 placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                  placeholder="you@email.com"
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Password</label>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 pl-9 pr-10 text-sm outline-none ring-offset-0 placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-neutral-400 hover:bg-neutral-800"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* OTP if required */}
            {otpRequired && (
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Authenticator Code</label>
                <div className="relative">
                  <ShieldCheck size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 pl-9 pr-3 text-sm outline-none ring-offset-0 placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                    placeholder="6-digit code"
                  />
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  Buka aplikasi Authenticator kamu, lalu masukkan 6 digit code.
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {otpRequired ? 'Verifying…' : 'Signing In…'}
                </>
              ) : (
                <>{otpRequired ? 'Verify Code' : 'Sign In'}</>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
            <span>© {new Date().getFullYear()} Launcx</span>
            <a href="/" className="underline decoration-neutral-700 hover:text-neutral-300">
              Back to site
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
