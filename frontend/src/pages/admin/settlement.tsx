'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Wallet,
  Filter,
  Download,
  Calendar,
} from 'lucide-react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

type SettlementFilters = {
  timezone: string
  dateFrom: string
  dateTo: string
  daysOfWeek: number[]
  hourStart: number
  hourEnd: number
  clientIds: string[]
  clientMode: 'include' | 'exclude'
  subMerchantIds: string[]
  subMerchantMode: 'include' | 'exclude'
  paymentMethods: string[]
  paymentMode: 'include' | 'exclude'
  minAmount: number | null
  maxAmount: number | null
  includeZeroAmount: boolean
}

type SettlementPreviewOrder = {
  id: string
  partnerClientId: string | null
  subMerchantId: string | null
  channel: string
  amount: number
  pendingAmount: number | null
  netAmount: number
  createdAt: string
}

type SettlementPreview = {
  totalOrders: number
  totalNetAmount: number
  batchSize: number
  estimatedBatches: number
  sample: SettlementPreviewOrder[]
}

type SettlementStatus = {
  settledOrders: number
  netAmount: number
  status: JobStatus
  error: string | null
  batches: number
  filters: SettlementFilters
  createdAt: string
  updatedAt: string
  cancelled: boolean
  preview: SettlementPreview | null
}

type ManualFormState = {
  dateFrom: string
  dateTo: string
  hourStart: string
  hourEnd: string
  clientIds: string
  clientMode: 'include' | 'exclude'
  subMerchantIds: string
  subMerchantMode: 'include' | 'exclude'
  paymentMethods: string
  paymentMode: 'include' | 'exclude'
  minAmount: string
  maxAmount: string
}

const dayOptions: { value: number; label: string }[] = [
  { value: 1, label: 'Senin' },
  { value: 2, label: 'Selasa' },
  { value: 3, label: 'Rabu' },
  { value: 4, label: 'Kamis' },
  { value: 5, label: 'Jumat' },
  { value: 6, label: 'Sabtu' },
  { value: 0, label: 'Minggu' },
]

const hourOptions = Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${i.toString().padStart(2, '0')}:00` }))

const splitInput = (value: string) =>
  value
    .split(/[,\n]/)
    .map(v => v.trim())
    .filter(Boolean)

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(value)

const formatNumber = (value: number) => new Intl.NumberFormat('id-ID').format(value)

export default function ManualSettlementPage() {
  useRequireAuth()

  const [form, setForm] = useState<ManualFormState>({
    dateFrom: '',
    dateTo: '',
    hourStart: '0',
    hourEnd: '23',
    clientIds: '',
    clientMode: 'include',
    subMerchantIds: '',
    subMerchantMode: 'include',
    paymentMethods: '',
    paymentMode: 'include',
    minAmount: '',
    maxAmount: '',
  })
  const [selectedDays, setSelectedDays] = useState<number[]>(dayOptions.map(d => d.value))
  const [preview, setPreview] = useState<SettlementPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<SettlementStatus | null>(null)
  const [error, setError] = useState('')

  const canSubmit = form.dateFrom && form.dateTo && selectedDays.length > 0

  const serializeFilters = (): Record<string, unknown> => ({
    dateFrom: form.dateFrom,
    dateTo: form.dateTo,
    daysOfWeek: selectedDays,
    hourStart: Number(form.hourStart),
    hourEnd: Number(form.hourEnd),
    clientIds: splitInput(form.clientIds),
    clientMode: form.clientMode,
    subMerchantIds: splitInput(form.subMerchantIds),
    subMerchantMode: form.subMerchantMode,
    paymentMethods: splitInput(form.paymentMethods),
    paymentMode: form.paymentMode,
    minAmount: form.minAmount ? Number(form.minAmount) : undefined,
    maxAmount: form.maxAmount ? Number(form.maxAmount) : undefined,
  })

  const handleToggleDay = (value: number) => {
    setSelectedDays(prev => {
      if (prev.includes(value)) {
        return prev.filter(v => v !== value)
      }
      return [...prev, value].sort((a, b) => a - b)
    })
  }

  const handlePreview = async () => {
    if (!canSubmit) {
      setError('Lengkapi tanggal, hari, dan jam terlebih dahulu')
      return
    }
    setError('')
    setPreviewLoading(true)
    try {
      const filters = serializeFilters()
      const res = await api.post<{ data: { preview: SettlementPreview } }>('/admin/settlement/preview', {
        filters,
      })
      setPreview(res.data.data.preview)
    } catch (err: any) {
      setPreview(null)
      setError(err?.response?.data?.error || 'Gagal membuat preview settlement')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleStart = async () => {
    if (!canSubmit) {
      setError('Lengkapi filter sebelum menjalankan settlement')
      return
    }
    setError('')
    setStatus(null)
    setJobId(null)
    setStarting(true)
    try {
      const filters = serializeFilters()
      const res = await api.post<{ data: { jobId: string } }>('/admin/settlement/start', {
        filters,
      })
      setJobId(res.data.data.jobId)
    } catch (err: any) {
      setStarting(false)
      setError(err?.response?.data?.error || 'Gagal memulai settlement')
    }
  }

  const handleCancel = async () => {
    if (!jobId) return
    setCancelling(true)
    setError('')
    try {
      await api.post(`/admin/settlement/cancel/${jobId}`, {})
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Tidak dapat membatalkan job')
    } finally {
      setCancelling(false)
    }
  }

  const handleDownload = async () => {
    if (!jobId) return
    setDownloading(true)
    setError('')
    try {
      const res = await api.get<{ data: { detail: any } }>(`/admin/settlement/export/${jobId}`)
      const exportFile = res.data.data.detail?.exportFile
      if (!exportFile) {
        setError('Summary belum tersedia untuk diunduh')
        return
      }
      const binary = atob(exportFile.content)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: exportFile.mimeType || 'text/csv' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = exportFile.fileName || `settlement-${jobId}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Gagal mengunduh summary settlement')
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    if (!jobId) return
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{ data: SettlementStatus }>(`/admin/settlement/status/${jobId}`)
        const data = res.data.data
        setStatus(data)
        if (!['queued', 'running'].includes(data.status)) {
          setStarting(false)
          clearInterval(interval)
        }
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Gagal mengambil status job')
        setStarting(false)
        clearInterval(interval)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [jobId])

  const inProgress = starting || (status && ['queued', 'running'].includes(status.status))

  const progressPercent = useMemo(() => {
    if (status?.status === 'completed') return 100
    if (status?.status === 'failed') return 100
    if (status?.status === 'cancelled') return 100
    if (status?.status === 'running') return 70
    if (status?.status === 'queued') return 30
    return starting ? 10 : 0
  }, [starting, status?.status])

  const statusBadge = (s?: JobStatus) => {
    const map: Record<JobStatus, string> = {
      queued: 'border-amber-900/40 bg-amber-950/40 text-amber-300',
      running: 'border-sky-900/40 bg-sky-950/40 text-sky-300',
      completed: 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300',
      failed: 'border-rose-900/40 bg-rose-950/40 text-rose-300',
      cancelled: 'border-neutral-700/40 bg-neutral-900/40 text-neutral-200',
    }
    const cls = s ? map[s] : 'border-neutral-800 bg-neutral-900 text-neutral-300'
    return (
      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${cls}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {s ? s.toUpperCase() : '—'}
      </span>
    )
  }

  const renderFilterSummary = () => {
    if (!status?.filters) return null
    const f = status.filters
    return (
      <div className="grid gap-2 text-xs text-neutral-400">
        <div>
          <span className="font-semibold text-neutral-200">Rentang Tanggal:</span>{' '}
          {f.dateFrom} → {f.dateTo}
        </div>
        <div>
          <span className="font-semibold text-neutral-200">Hari:</span>{' '}
          {f.daysOfWeek
            .map(day => dayOptions.find(d => d.value === day)?.label ?? day)
            .join(', ')}
        </div>
        <div>
          <span className="font-semibold text-neutral-200">Jam:</span>{' '}
          {`${f.hourStart.toString().padStart(2, '0')}:00 - ${f.hourEnd.toString().padStart(2, '0')}:59`}
        </div>
        {f.clientIds.length > 0 && (
          <div>
            <span className="font-semibold text-neutral-200">Klien ({f.clientMode}):</span>{' '}
            {f.clientIds.join(', ')}
          </div>
        )}
        {f.subMerchantIds.length > 0 && (
          <div>
            <span className="font-semibold text-neutral-200">Sub Merchant ({f.subMerchantMode}):</span>{' '}
            {f.subMerchantIds.join(', ')}
          </div>
        )}
        {f.paymentMethods.length > 0 && (
          <div>
            <span className="font-semibold text-neutral-200">Metode Pembayaran ({f.paymentMode}):</span>{' '}
            {f.paymentMethods.join(', ')}
          </div>
        )}
        {(f.minAmount != null || f.maxAmount != null) && (
          <div>
            <span className="font-semibold text-neutral-200">Nominal:</span>{' '}
            {f.minAmount != null ? formatCurrency(f.minAmount) : '—'} {'→'}{' '}
            {f.maxAmount != null ? formatCurrency(f.maxAmount) : '—'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="inline-grid h-11 w-11 place-items-center rounded-xl border border-neutral-800 bg-neutral-900">
              <Wallet size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Manual Settlement</h1>
              <p className="text-xs text-neutral-400">Jalankan settlement manual dengan filter yang lebih presisi.</p>
            </div>
          </div>
          {statusBadge(status?.status)}
        </header>

        {error && (
          <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-200">
                <Filter size={16} /> Filter Settlement
              </div>

              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs uppercase tracking-wide text-neutral-400">
                    Dari Tanggal
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                      <Calendar size={16} className="text-neutral-500" />
                      <input
                        type="date"
                        value={form.dateFrom}
                        onChange={e => setForm(prev => ({ ...prev, dateFrom: e.target.value }))}
                        className="w-full bg-transparent text-sm outline-none"
                      />
                    </div>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-neutral-400">
                    Sampai Tanggal
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                      <Calendar size={16} className="text-neutral-500" />
                      <input
                        type="date"
                        value={form.dateTo}
                        onChange={e => setForm(prev => ({ ...prev, dateTo: e.target.value }))}
                        className="w-full bg-transparent text-sm outline-none"
                      />
                    </div>
                  </label>
                </div>

                <div>
                  <span className="text-xs uppercase tracking-wide text-neutral-400">Hari</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {dayOptions.map(day => {
                      const active = selectedDays.includes(day.value)
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => handleToggleDay(day.value)}
                          className={`rounded-lg border px-3 py-1 text-xs transition ${
                            active
                              ? 'border-indigo-500/70 bg-indigo-600/20 text-indigo-200'
                              : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700'
                          }`}
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs uppercase tracking-wide text-neutral-400">
                    Jam Mulai
                    <select
                      className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                      value={form.hourStart}
                      onChange={e => setForm(prev => ({ ...prev, hourStart: e.target.value }))}
                    >
                      {hourOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-neutral-400">
                    Jam Akhir
                    <select
                      className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                      value={form.hourEnd}
                      onChange={e => setForm(prev => ({ ...prev, hourEnd: e.target.value }))}
                    >
                      {hourOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-neutral-400">
                      ID Client (pisahkan dengan koma)
                      <textarea
                        value={form.clientIds}
                        onChange={e => setForm(prev => ({ ...prev, clientIds: e.target.value }))}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400">
                      <input
                        type="checkbox"
                        checked={form.clientMode === 'exclude'}
                        onChange={e =>
                          setForm(prev => ({ ...prev, clientMode: e.target.checked ? 'exclude' : 'include' }))
                        }
                        className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-900"
                      />
                      Kecualikan daftar di atas
                    </label>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-neutral-400">
                      ID Sub Merchant
                      <textarea
                        value={form.subMerchantIds}
                        onChange={e => setForm(prev => ({ ...prev, subMerchantIds: e.target.value }))}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400">
                      <input
                        type="checkbox"
                        checked={form.subMerchantMode === 'exclude'}
                        onChange={e =>
                          setForm(prev => ({ ...prev, subMerchantMode: e.target.checked ? 'exclude' : 'include' }))
                        }
                        className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-900"
                      />
                      Kecualikan daftar di atas
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-neutral-400">
                    Metode Pembayaran
                    <textarea
                      value={form.paymentMethods}
                      onChange={e => setForm(prev => ({ ...prev, paymentMethods: e.target.value }))}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={form.paymentMode === 'exclude'}
                      onChange={e =>
                        setForm(prev => ({ ...prev, paymentMode: e.target.checked ? 'exclude' : 'include' }))
                      }
                      className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-900"
                    />
                    Kecualikan daftar di atas
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs uppercase tracking-wide text-neutral-400">
                    Nominal Minimum (IDR)
                    <input
                      type="number"
                      value={form.minAmount}
                      onChange={e => setForm(prev => ({ ...prev, minAmount: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                    />
                  </label>
                  <label className="text-xs uppercase tracking-wide text-neutral-400">
                    Nominal Maksimum (IDR)
                    <input
                      type="number"
                      value={form.maxAmount}
                      onChange={e => setForm(prev => ({ ...prev, maxAmount: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={handlePreview}
                  disabled={!canSubmit || previewLoading}
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-800 disabled:opacity-60"
                >
                  {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
                  Preview
                </button>
                <button
                  onClick={handleStart}
                  disabled={!canSubmit || !!inProgress}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
                >
                  {inProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {inProgress ? 'Memproses…' : 'Mulai Settlement'}
                </button>
                {jobId && (
                  <div className="ml-auto text-xs text-neutral-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={14} /> Job ID: <b className="font-mono text-neutral-200">{jobId}</b>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {preview && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-200">
                  <Filter size={16} /> Preview Hasil
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-xs text-neutral-400">Perkiraan Order</div>
                    <div className="mt-1 text-xl font-semibold">{formatNumber(preview.totalOrders)}</div>
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-xs text-neutral-400">Total Settlement</div>
                    <div className="mt-1 text-xl font-semibold">{formatCurrency(preview.totalNetAmount)}</div>
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-xs text-neutral-400">Batch Size</div>
                    <div className="mt-1 text-xl font-semibold">{formatNumber(preview.batchSize)}</div>
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-xs text-neutral-400">Perkiraan Batch</div>
                    <div className="mt-1 text-xl font-semibold">{formatNumber(preview.estimatedBatches)}</div>
                  </div>
                </div>
                {preview.sample.length > 0 && (
                  <div className="mt-5">
                    <div className="mb-2 text-xs font-semibold uppercase text-neutral-400">Sample Order</div>
                    <div className="overflow-hidden rounded-lg border border-neutral-800">
                      <table className="w-full min-w-[600px] table-auto text-sm">
                        <thead className="bg-neutral-900 text-xs uppercase text-neutral-400">
                          <tr>
                            <th className="px-3 py-2 text-left">Order ID</th>
                            <th className="px-3 py-2 text-left">Client</th>
                            <th className="px-3 py-2 text-left">Sub Merchant</th>
                            <th className="px-3 py-2 text-left">Channel</th>
                            <th className="px-3 py-2 text-right">Net Amount</th>
                            <th className="px-3 py-2 text-right">Pending Amount</th>
                            <th className="px-3 py-2 text-left">Created At</th>
                          </tr>
                        </thead>
                        <tbody className="bg-neutral-950/80">
                          {preview.sample.map(order => (
                            <tr key={order.id} className="border-t border-neutral-900/60">
                              <td className="px-3 py-2 font-mono text-xs text-indigo-200">{order.id}</td>
                              <td className="px-3 py-2 text-xs text-neutral-300">{order.partnerClientId ?? '—'}</td>
                              <td className="px-3 py-2 text-xs text-neutral-300">{order.subMerchantId ?? '—'}</td>
                              <td className="px-3 py-2 text-xs text-neutral-300">{order.channel}</td>
                              <td className="px-3 py-2 text-right text-xs text-neutral-200">{formatCurrency(order.netAmount)}</td>
                              <td className="px-3 py-2 text-right text-xs text-neutral-400">
                                {order.pendingAmount != null ? formatCurrency(order.pendingAmount) : '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-neutral-400">{order.createdAt}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl">
              <div className="mb-4 text-sm font-semibold text-neutral-200">Status Job</div>

              <div className="w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
                <div
                  className={`h-3 transition-all ${
                    status?.status === 'failed' ? 'bg-rose-600' : status?.status === 'cancelled' ? 'bg-neutral-600' : 'bg-indigo-600'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {status && ['queued', 'running'].includes(status.status) && (
                <div className="mt-4 flex items-center gap-2 text-sm text-neutral-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{status.status === 'queued' ? 'Menunggu antrian…' : 'Sedang diproses…'}</span>
                </div>
              )}

              {status && status.status === 'completed' && (
                <div className="mt-4 rounded-xl border border-emerald-900/40 bg-emerald-950/40 p-3 text-sm text-emerald-300">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4" />
                    <div className="space-y-1">
                      <div className="font-medium">Settlement selesai</div>
                      <div className="text-emerald-200/90">Order Settled: <b>{formatNumber(status.settledOrders)}</b></div>
                      <div className="text-emerald-200/90">Total Settlement: <b>{formatCurrency(status.netAmount)}</b></div>
                      <div className="text-emerald-200/90">Total Batch: <b>{formatNumber(status.batches)}</b></div>
                    </div>
                  </div>
                </div>
              )}

              {status && status.status === 'failed' && (
                <div className="mt-4 rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-sm text-rose-300">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <div>
                      <div className="font-medium">Settlement gagal</div>
                      <div className="text-rose-200/90">{status.error || 'Silakan cek log untuk detail.'}</div>
                    </div>
                  </div>
                </div>
              )}

              {status && status.status === 'cancelled' && (
                <div className="mt-4 rounded-xl border border-neutral-700/40 bg-neutral-900/60 p-3 text-sm text-neutral-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <div>
                      <div className="font-medium">Job dibatalkan</div>
                      <div className="text-neutral-300/80">{status.error || 'Job dihentikan oleh admin.'}</div>
                    </div>
                  </div>
                </div>
              )}

              {status && renderFilterSummary()}

              <div className="mt-6 flex flex-wrap gap-2">
                {jobId && inProgress && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-800 disabled:opacity-60"
                  >
                    {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Batalkan Job
                  </button>
                )}
                {jobId && !inProgress && (
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-800 disabled:opacity-60"
                  >
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Unduh Summary
                  </button>
                )}
              </div>
            </div>

            {status && (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 text-xs text-neutral-400">
                <div className="grid gap-2">
                  <div>
                    <span className="font-semibold text-neutral-200">Dibuat:</span>{' '}
                    {new Date(status.createdAt).toLocaleString('id-ID')}
                  </div>
                  <div>
                    <span className="font-semibold text-neutral-200">Update Terakhir:</span>{' '}
                    {new Date(status.updatedAt).toLocaleString('id-ID')}
                  </div>
                  {status.error && (
                    <div>
                      <span className="font-semibold text-neutral-200">Keterangan:</span>{' '}
                      {status.error}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-neutral-500">
          Catatan: Filter menggunakan zona waktu Asia/Jakarta. Preview memberikan estimasi sebelum job dijalankan.
        </p>
      </div>
    </div>
  )
}
