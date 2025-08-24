'use client'

import { useEffect, useMemo, useState } from 'react'
import { Play, Loader2, CheckCircle2, AlertCircle, Clock, RefreshCw, Wallet } from 'lucide-react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

interface Status {
  settledOrders: number
  netAmount: number
  status: JobStatus
}

export default function ManualSettlementPage() {
  useRequireAuth()

  const [starting, setStarting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')

  const start = async () => {
    setError('')
    setStatus(null)
    setJobId(null)
    setStarting(true)
    try {
      const res = await api.post<{ data: { jobId: string } }>('/admin/settlement/start', {})
      setJobId(res.data.data.jobId)
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to start settlement')
      setStarting(false)
    }
  }

  // Polling status
  useEffect(() => {
    if (!jobId) return
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{ data: Status }>(`/admin/settlement/status/${jobId}`)
        const data = res.data.data
        setStatus(data)
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval)
          setStarting(false)
        }
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Failed to fetch status')
        clearInterval(interval)
        setStarting(false)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [jobId])

  const inProgress = starting || (status && (status.status === 'queued' || status.status === 'running'))

  const progressPercent = useMemo(() => {
    switch (status?.status) {
      case 'queued':
        return 20
      case 'running':
        return 70
      case 'completed':
      case 'failed':
        return 100
      default:
        return starting ? 10 : 0
    }
  }, [status?.status, starting])

  const statusBadge = (s?: JobStatus) => {
    const map: Record<JobStatus, string> = {
      queued: 'border-amber-900/40 bg-amber-950/40 text-amber-300',
      running: 'border-sky-900/40 bg-sky-950/40 text-sky-300',
      completed: 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300',
      failed: 'border-rose-900/40 bg-rose-950/40 text-rose-300',
    }
    const cls = s ? map[s] : 'border-neutral-800 bg-neutral-900 text-neutral-300'
    return (
      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${cls}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {s ? s.toUpperCase() : '—'}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-grid h-11 w-11 place-items-center rounded-xl border border-neutral-800 bg-neutral-900">
              <Wallet size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Manual Settlement</h1>
              <p className="text-xs text-neutral-400">Jalankan settlement secara manual dan pantau progresnya.</p>
            </div>
          </div>
          {statusBadge(status?.status)}
        </header>

        {/* Error banner */}
        {error && (
          <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={start}
              disabled={!!inProgress}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
            >
              {inProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {inProgress ? 'Processing…' : 'Start Settlement'}
            </button>

            {/* Secondary info */}
            <div className="ml-auto text-xs text-neutral-400">
              {jobId ? (
                <span className="inline-flex items-center gap-1">
                  <Clock size={14} /> Job ID: <b className="font-mono">{jobId}</b>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Clock size={14} /> Ready
                </span>
              )}
            </div>
          </div>

          {/* Progress */}
          {(inProgress || status) && (
            <div className="mt-5 space-y-4">
              <div className="w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
                <div
                  className={`h-3 transition-all ${
                    status?.status === 'failed' ? 'bg-rose-600' : 'bg-indigo-600'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Status row */}
              {status && (status.status === 'queued' || status.status === 'running') && (
                <div className="flex items-center gap-2 text-sm text-neutral-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{status.status === 'queued' ? 'Waiting to run…' : 'Processing…'}</span>
                </div>
              )}

              {/* Completed */}
              {status && status.status === 'completed' && (
                <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/40 p-3 text-sm text-emerald-300">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4" />
                    <div className="space-y-1">
                      <div className="font-medium">Settlement selesai</div>
                      <div className="text-emerald-200/90">
                        Settled Orders: <b>{status.settledOrders.toLocaleString('id-ID')}</b>
                      </div>
                      <div className="text-emerald-200/90">
                        Net Amount:{' '}
                        <b>
                          {status.netAmount.toLocaleString('id-ID', {
                            style: 'currency',
                            currency: 'IDR',
                          })}
                        </b>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Failed */}
              {status && status.status === 'failed' && (
                <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-sm text-rose-300">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <div>
                      <div className="font-medium">Settlement gagal</div>
                      <div className="text-rose-200/90">Silakan cek logs dan jalankan ulang.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Restart hint when finished */}
              {status && (status.status === 'completed' || status.status === 'failed') && (
                <div className="pt-2">
                  <button
                    onClick={start}
                    className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold hover:bg-neutral-800"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Jalankan ulang
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footnote */}
        <p className="text-xs text-neutral-500">
          Catatan: Progress persentase bersifat indikatif (queued → running → selesai/gagal).
        </p>
      </div>
    </div>
  )
}
