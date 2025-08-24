'use client'

import React, { useEffect, useState, FormEvent } from 'react'
import apiClient from '@/lib/apiClient'
import QRCode from 'qrcode'
import {
  Bell,
  Copy,
  CheckCircle2,
  AlertCircle,
  Shield,
  ScanLine,
  KeyRound,
  RefreshCw,
} from 'lucide-react'

export default function CallbackPage() {
  // Callback settings
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  // Password change
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMessage, setPwMessage] = useState('')
  const [pwError, setPwError] = useState(false)

  // 2FA
  const [loading2FA, setLoading2FA] = useState(true)
  const [is2FAEnabled, setIs2FAEnabled] = useState(false)
  const [qr, setQr] = useState('')
  const [otp, setOtp] = useState('')
  const [faMsg, setFaMsg] = useState('')
  const [working, setWorking] = useState(false) // kecil buat tombol 2FA

  // Initial fetch
  useEffect(() => {
    apiClient
      .get('/client/callback-url')
      .then((res) => {
        setUrl(res.data.callbackUrl || '')
        setSecret(res.data.callbackSecret || '')
      })
      .catch(() => {
        setMessage('Failed to load callback data')
        setIsError(true)
      })

    ;(async () => {
      try {
        const res = await apiClient.get('/client/2fa/status')
        setIs2FAEnabled(!!res.data.totpEnabled)
      } catch {
        // ignore
      } finally {
        setLoading2FA(false)
      }
    })()
  }, [])

  const flash = (msg: string, error = false) => {
    setMessage(msg)
    setIsError(error)
    window.setTimeout(() => {
      setMessage('')
      setIsError(false)
    }, 3500)
  }

  const pwFlash = (msg: string, error = false) => {
    setPwMessage(msg)
    setPwError(error)
    window.setTimeout(() => {
      setPwMessage('')
      setPwError(false)
    }, 3500)
  }

  // Save callback
  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    setIsError(false)
    try {
      const res = await apiClient.post('/client/callback-url', { callbackUrl: url })
      setUrl(res.data.callbackUrl)
      if (res.data.callbackSecret) setSecret(res.data.callbackSecret)
      flash('Callback URL & Secret saved successfully!')
    } catch {
      flash('Failed to save callback URL', true)
    } finally {
      setSaving(false)
    }
  }

  // Copy secret
  const copySecret = () => {
    if (!secret) return
    navigator.clipboard.writeText(secret)
    flash('Secret copied to clipboard!', false)
  }

  // Change password
  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      pwFlash('Password confirmation does not match', true)
      return
    }
    setPwSaving(true)
    setPwMessage('')
    setPwError(false)
    try {
      await apiClient.post('/client/change-password', { oldPassword, newPassword })
      pwFlash('Password changed successfully!')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      pwFlash('Failed to change password', true)
    } finally {
      setPwSaving(false)
    }
  }

  // 2FA FLOW
  const setup2FA = async () => {
    try {
      setWorking(true)
      const { data } = await apiClient.post('/client/2fa/setup')
      const dataUrl = await QRCode.toDataURL(data.otpauthUrl)
      setQr(dataUrl)
      setFaMsg('Scan QR dengan Authenticator, lalu masukkan OTP berikutnya.')
    } catch {
      setFaMsg('Failed to set up 2FA')
    } finally {
      setWorking(false)
    }
  }

  const enable2FA = async () => {
    try {
      setWorking(true)
      await apiClient.post('/client/2fa/enable', { code: otp })
      setFaMsg('2FA enabled successfully')
      setIs2FAEnabled(true)
      setQr('')
      setOtp('')
    } catch {
      setFaMsg('Invalid OTP')
    } finally {
      setWorking(false)
    }
  }

  const regenerate2FA = async () => {
    setIs2FAEnabled(false) // masuk ke flow setup lagi
    await setup2FA()
    setFaMsg('New 2FA secret generated. Scan ulang QR, lalu verifikasi.')
  }

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await enable2FA()
  }

  // Small UI helpers
  const StatusChip = ({ active }: { active: boolean }) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        active
          ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
          : 'border-amber-900/40 bg-amber-950/40 text-amber-300'
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          active ? 'bg-emerald-400' : 'bg-amber-400'
        }`}
      />
      {active ? 'Aktif' : 'Belum Aktif'}
    </span>
  )

  const Step = ({
    idx,
    title,
    desc,
    done,
    icon,
  }: {
    idx: number
    title: string
    desc: string
    done?: boolean
    icon: React.ReactNode
  }) => (
    <div className="flex gap-3">
      <div
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          done
            ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
            : 'border-neutral-800 bg-neutral-900 text-neutral-300'
        }`}
      >
        {icon}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{idx}. {title}</p>
          {done && <CheckCircle2 size={16} className="text-emerald-400" />}
        </div>
        <p className="mt-0.5 text-xs text-neutral-400">{desc}</p>
      </div>
    </div>
  )

  return (
    <div className="dark min-h-screen bg-neutral-950 px-4 py-6 text-neutral-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* CARD: Callback */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900">
              <Bell size={20} />
            </div>
            <h1 className="text-xl font-semibold">Callback Settings</h1>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="cbUrl" className="mb-1 block text-sm text-neutral-300">
                Transactions Callback URL
              </label>
              <input
                id="cbUrl"
                type="url"
                placeholder="https://domain.com/callback"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={saving}
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm text-neutral-300">Callback Secret</label>
              <div className="relative">
                <input
                  type="text"
                  readOnly
                  value={secret}
                  className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 pr-12 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                />
                <button
                  type="button"
                  onClick={copySecret}
                  title="Copy secret"
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60"
                >
                  <Copy size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !url.trim()}
              className="inline-flex items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm font-medium transition hover:bg-neutral-800/60 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Callback'}
            </button>
            {message && (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  isError
                    ? 'border-rose-900/40 bg-rose-950/40 text-rose-300'
                    : 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
                }`}
              >
                {isError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span>{message}</span>
              </div>
            )}
          </div>
        </div>

        {/* CARD: 2FA */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900">
                <Shield size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Two-Factor Authentication</h2>
                <p className="text-xs text-neutral-400">
                  Tambahkan lapisan keamanan ekstra menggunakan aplikasi Authenticator.
                </p>
              </div>
            </div>
            <StatusChip active={is2FAEnabled} />
          </div>

          {loading2FA ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
              Loading 2FA status…
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Steps / Controls */}
              <div className="space-y-4">
                <Step
                  idx={1}
                  title={is2FAEnabled ? '2FA Aktif' : 'Generate Secret & QR'}
                  desc={
                    is2FAEnabled
                      ? '2FA sudah aktif untuk akun Anda.'
                      : 'Buat secret & QR, lalu scan dengan Google Authenticator atau Authy.'
                  }
                  done={is2FAEnabled || !!qr}
                  icon={<KeyRound size={16} />}
                />
                <Step
                  idx={2}
                  title="Scan QR"
                  desc="Buka app Authenticator dan scan QR code."
                  done={!!qr && !is2FAEnabled}
                  icon={<ScanLine size={16} />}
                />
                <Step
                  idx={3}
                  title="Verify OTP"
                  desc="Masukkan 6-digit OTP dari aplikasi untuk mengaktifkan."
                  done={is2FAEnabled}
                  icon={<CheckCircle2 size={16} />}
                />

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {!is2FAEnabled && !qr && (
                    <button
                      onClick={setup2FA}
                      disabled={working}
                      className="inline-flex items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm font-medium transition hover:bg-neutral-800/60 disabled:opacity-50"
                    >
                      {working ? 'Preparing…' : 'Enable 2FA'}
                    </button>
                  )}

                  {is2FAEnabled && (
                    <button
                      onClick={regenerate2FA}
                      disabled={working}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm font-medium transition hover:bg-neutral-800/60 disabled:opacity-50"
                    >
                      <RefreshCw size={16} />
                      {working ? 'Generating…' : 'Regenerate 2FA'}
                    </button>
                  )}

                  {!!faMsg && (
                    <span className="text-xs text-neutral-300">{faMsg}</span>
                  )}
                </div>
              </div>

              {/* QR + Verify */}
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                {is2FAEnabled ? (
                  <div className="grid place-items-center py-10 text-center">
                    <CheckCircle2 size={36} className="mb-2 text-emerald-400" />
                    <p className="text-sm text-neutral-300">
                      2FA sudah aktif. Anda dapat meregenerasi secret jika diperlukan.
                    </p>
                  </div>
                ) : qr ? (
                  <form autoComplete="off" onSubmit={handleVerify} className="space-y-4">
                    {/* dummy fields to absorb autofill */}
                    <input type="text" name="username" autoComplete="username" className="hidden" />
                    <input type="password" name="new-password" autoComplete="new-password" className="hidden" />

                    <img
                      src={qr}
                      alt="QR Code"
                      className="mx-auto rounded-lg border border-neutral-800 bg-neutral-900 p-3"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        name="otp"
                        autoComplete="one-time-code"
                        placeholder="Enter 2FA code"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        inputMode="numeric"
                        pattern="\d*"
                        className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                      />
                      <button
                        type="submit"
                        disabled={working || !otp.trim()}
                        className="h-11 rounded-xl border border-neutral-800 bg-neutral-900 px-4 text-sm font-medium transition hover:bg-neutral-800/60 disabled:opacity-50"
                      >
                        {working ? 'Verifying…' : 'Verify OTP'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="grid place-items-center py-10 text-center text-sm text-neutral-400">
                    2FA belum aktif. Klik <span className="mx-1 font-medium text-neutral-200">Enable 2FA</span> untuk
                    memulai.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* CARD: Change password */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Change Password</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm text-neutral-300">Old Password</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                disabled={pwSaving}
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={pwSaving}
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={pwSaving}
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleChangePassword}
              disabled={pwSaving || !oldPassword || !newPassword}
              className="inline-flex items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm font-medium transition hover:bg-neutral-800/60 disabled:opacity-50"
            >
              {pwSaving ? 'Saving…' : 'Change Password'}
            </button>

            {pwMessage && (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  pwError
                    ? 'border-rose-900/40 bg-rose-950/40 text-rose-300'
                    : 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
                }`}
              >
                {pwError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span>{pwMessage}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
