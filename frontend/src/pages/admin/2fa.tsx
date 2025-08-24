'use client'

import { useEffect, useState, FormEvent } from 'react'
import { useRequireAuth } from '@/hooks/useAuth'
import api from '@/lib/api'
import QRCode from 'qrcode'
import { Shield, CheckCircle2, AlertCircle, Loader2, QrCode, RefreshCw } from 'lucide-react'

export default function AdminTwoFaPage() {
  useRequireAuth()
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [qr, setQr] = useState('')
  const [otp, setOtp] = useState('')
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.get('/admin/2fa/status')
        setEnabled(!!res.data.totpEnabled)
      } catch {
        /* silent */
      } finally {
        setLoading(false)
      }
    }
    fetchStatus()
  }, [])

  const setup = async () => {
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      const { data } = await api.post('/admin/2fa/setup')
      const dataUrl = await QRCode.toDataURL(data.otpauthUrl)
      setQr(dataUrl)
      setEnabled(false)
      setIsError(false)
      setMsg('Scan QR dengan aplikasi Authenticator, lalu masukkan OTP berikutnya.')
    } catch {
      setIsError(true)
      setMsg('Gagal menyiapkan 2FA. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  const enable = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.post('/admin/2fa/enable', { code: otp })
      setIsError(false)
      setMsg('2FA berhasil diaktifkan.')
      setEnabled(true)
      setQr('')
      setOtp('')
    } catch {
      setIsError(true)
      setMsg('OTP tidak valid. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async () => {
    setOtp('')
    setEnabled(false)
    await setup()
    setIsError(false)
    setMsg('Secret 2FA baru dibuat. Scan ulang QR dan verifikasi OTP.')
  }

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await enable()
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-grid h-11 w-11 place-items-center rounded-xl border border-neutral-800 bg-neutral-900">
              <Shield size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Two-Factor Authentication</h1>
              <p className="text-xs text-neutral-400">
                Tambahkan lapisan keamanan ekstra dengan OTP dari aplikasi Authenticator.
              </p>
            </div>
          </div>

          {!loading && (
            <div
              className={[
                'hidden sm:inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
                enabled
                  ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
                  : 'border-amber-900/40 bg-amber-950/40 text-amber-300',
              ].join(' ')}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {enabled ? 'Aktif' : 'Belum aktif'}
            </div>
          )}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat status 2FA…
            </div>
          ) : (
            <>
              {/* When already enabled */}
              {enabled && !qr && (
                <div className="space-y-5">
                  <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-900/40 bg-emerald-950/40 px-3 py-1.5 text-sm text-emerald-300">
                    <CheckCircle2 size={16} />
                    2FA aktif untuk akun ini.
                  </div>
                  <p className="text-sm text-neutral-300">
                    Jika kamu ingin mengatur ulang secret (misalnya ganti perangkat), buat QR baru dan verifikasi ulang.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={regenerate}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600"
                    >
                      <RefreshCw size={16} />
                      Regenerate 2FA
                    </button>
                  </div>
                </div>
              )}

              {/* Setup or Verify */}
              {!enabled && (
                <>
                  {/* Setup section (show button if no QR yet) */}
                  {!qr && (
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-base font-semibold">Aktifkan 2FA</h2>
                        <p className="text-xs text-neutral-400">
                          Kami akan membuat secret dan QR untuk dipindai di aplikasi Authenticator.
                        </p>
                      </div>
                      <button
                        onClick={setup}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
                      >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                        Setup 2FA
                      </button>
                    </div>
                  )}

                  {/* QR + Verify form */}
                  {qr && (
                    <div className="mt-5 grid gap-5 sm:grid-cols-2">
                      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                        <img
                          src={qr}
                          alt="QR Code"
                          className="h-auto w-56 rounded-lg border border-neutral-800 bg-neutral-950 p-2"
                        />
                        <p className="text-center text-xs text-neutral-400">
                          Scan QR di Google Authenticator / Authy, lalu masukkan 6-digit kode berikutnya.
                        </p>
                      </div>

                      <form autoComplete="off" onSubmit={handleVerify} className="flex flex-col justify-center gap-3">
                        {/* anti-autofill */}
                        <input type="text" name="username" autoComplete="username" className="hidden" />
                        <input type="password" name="new-password" autoComplete="new-password" className="hidden" />

                        <label className="text-sm text-neutral-300">Masukkan OTP</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            name="otp"
                            autoComplete="one-time-code"
                            placeholder="6 digit OTP"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none ring-offset-0 placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                          />
                          <button
                            type="submit"
                            disabled={busy || otp.length < 6}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
                          >
                            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                            Verify
                          </button>
                        </div>
                        <p className="text-xs text-neutral-500">
                          OTP berubah tiap 30 detik. Jika gagal, tunggu kode baru lalu coba lagi.
                        </p>
                      </form>
                    </div>
                  )}
                </>
              )}

              {/* Messages */}
              {msg && (
                <div
                  className={[
                    'mt-5 inline-flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-sm',
                    isError
                      ? 'border-rose-900/40 bg-rose-950/40 text-rose-300'
                      : 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300',
                  ].join(' ')}
                >
                  {isError ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
                  <span className="leading-relaxed">{msg}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
