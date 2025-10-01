'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import DatePicker from 'react-datepicker'

import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

dayjs.extend(utc)
dayjs.extend(timezone)

if (typeof window !== 'undefined') {
  void import('react-datepicker/dist/react-datepicker.css')
}

const WIB = 'Asia/Jakarta'
const DEFAULT_PAGE_SIZE = 1500
const DATEPICKER_PORTAL_ID = 'datepicker-portal'

function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return null
  }
}

type SubMerchantOption = {
  id: string
  name?: string | null
}

type SettlementRow = {
  id: string
  subMerchantId: string
  subMerchantName?: string | null
  status: string
  settlementTime: string
  settlementAmount?: number | null
  amount?: number | null
  feeLauncx?: number | null
  fee3rdParty?: number | null
}

type ReversalResponse = {
  processed?: number
  totalReversalAmount?: number
  ok?: number
  fail?: number
  errors?: { id?: string; message?: string }[]
}

type ToastState =
  | { type: 'success'; title: string; message: string; detail?: string }
  | { type: 'error'; title: string; message: string; detail?: string }
  | { type: 'warning'; title: string; message: string; detail?: string }
  | null

// Pakai strategy: 'fixed' agar tidak terpengaruh transform/overflow parent
function formatCurrency(value: number) {
  return value.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })
}

export function toWibStart(date: Date) {
  return dayjs(date).tz(WIB, true).startOf('day')
}

export function toWibExclusiveEnd(date: Date) {
  return dayjs(date).tz(WIB, true).startOf('day').add(1, 'day')
}

function computeReversalPreview(
  row: Pick<SettlementRow, 'settlementAmount' | 'amount' | 'feeLauncx' | 'fee3rdParty'>
) {
  if (row.settlementAmount != null) {
    return Number(row.settlementAmount) || 0
  }

  const amount = Number(row.amount ?? 0)
  const feeLauncx = Number(row.feeLauncx ?? 0)
  const fee3rdParty = Number(row.fee3rdParty ?? 0)
  const net = amount - feeLauncx - fee3rdParty
  return Number.isFinite(net) ? Math.max(net, 0) : 0
}

type SettlementAdjustJobStatus = 'idle' | 'starting' | 'queued' | 'running' | 'completed' | 'failed'

type SettlementAdjustJobSummary = {
  processed?: number
  total?: number
  updatedCount?: number
  updatedIds?: string[]
  message?: string
  errors?: { id?: string; message?: string }[]
}

const JOB_STATUS_LABEL: Record<Exclude<SettlementAdjustJobStatus, 'idle' | 'starting'>, string> = {
  queued: 'Dalam antrean',
  running: 'Sedang diproses',
  completed: 'Selesai',
  failed: 'Gagal',
}

const POLL_INTERVAL_MS = 2000

function normaliseJobStatus(rawStatus: unknown): SettlementAdjustJobStatus {
  const value = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : ''
  if (value === 'queued' || value === 'pending') return 'queued'
  if (value === 'running' || value === 'in_progress' || value === 'processing') return 'running'
  if (value === 'completed' || value === 'done' || value === 'success') return 'completed'
  if (value === 'failed' || value === 'error') return 'failed'
  return 'running'
}

function extractNumber(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }
  }
  return undefined
}

function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map(item => (typeof item === 'string' ? item : item != null ? String(item) : null))
    .filter((item): item is string => Boolean(item))
}

export interface SettlementAdjustJobControlProps {
  selectedSubMerchant: string
  dateRange: [Date | null, Date | null]
  onJobFinished?: () => void
  apiClient?: typeof api
}

export function SettlementAdjustJobControl({
  selectedSubMerchant,
  dateRange,
  onJobFinished,
  apiClient = api,
}: SettlementAdjustJobControlProps) {
  const [jobId, setJobId] = useState('')
  const [jobStatus, setJobStatus] = useState<SettlementAdjustJobStatus>('idle')
  const [jobError, setJobError] = useState('')
  const [jobSummary, setJobSummary] = useState<SettlementAdjustJobSummary>({})
  const pollTimerRef = useRef<number | null>(null)

  const [startDate, endDate] = dateRange

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const pollStatus = useCallback(
    async (targetJobId: string) => {
      if (!targetJobId) return
      try {
        const { data } = await apiClient.get<Record<string, any>>(
          `/admin/settlement/adjust/status/${targetJobId}`
        )

        const statusSource =
          data?.status ?? data?.jobStatus ?? data?.state ?? data?.job_state ?? 'running'
        const normalised = normaliseJobStatus(statusSource)

        const processed = extractNumber(
          data?.processed,
          data?.progress?.processed,
          data?.summary?.processed,
          data?.result?.processed
        )
        const total = extractNumber(
          data?.total,
          data?.progress?.total,
          data?.summary?.total,
          data?.result?.total
        )
        const updatedCount = extractNumber(
          data?.updatedCount,
          data?.result?.updatedCount,
          data?.summary?.updatedCount,
          data?.processed
        )
        const updatedIds =
          extractStringArray(data?.updatedIds) ?? extractStringArray(data?.result?.updatedIds)
        const errors = Array.isArray(data?.errors)
          ? data.errors.map((err: any) => ({
              id: err?.id ?? err?.orderId ?? err?.order_id ?? undefined,
              message:
                typeof err?.message === 'string'
                  ? err.message
                  : typeof err === 'string'
                  ? err
                  : undefined,
            }))
          : undefined

        setJobStatus(normalised)
        setJobSummary({
          processed,
          total,
          updatedCount,
          updatedIds,
          message: typeof data?.message === 'string' ? data.message : undefined,
          errors,
        })

        if (normalised === 'completed') {
          stopPolling()
          setJobError('')
          onJobFinished?.()
        } else if (normalised === 'failed') {
          stopPolling()
          const errorMessage =
            data?.error ??
            data?.message ??
            data?.details ??
            'Job settlement adjust gagal dijalankan.'
          setJobError(typeof errorMessage === 'string' ? errorMessage : 'Job settlement adjust gagal.')
        } else {
          setJobError('')
        }
      } catch (err: any) {
        stopPolling()
        setJobStatus('failed')
        setJobError(
          err?.response?.data?.error ??
            err?.message ??
            'Gagal memeriksa status job settlement adjust'
        )
      }
    },
    [apiClient, onJobFinished, stopPolling]
  )

  const schedulePolling = useCallback(
    (targetJobId: string) => {
      stopPolling()
      pollTimerRef.current = window.setInterval(() => {
        void pollStatus(targetJobId)
      }, POLL_INTERVAL_MS)
    },
    [pollStatus, stopPolling]
  )

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  const startJob = useCallback(async () => {
    setJobError('')
    setJobSummary({})

    if (!selectedSubMerchant) {
      setJobStatus('failed')
      setJobError('Pilih sub-merchant terlebih dahulu.')
      return
    }

    if (!startDate || !endDate) {
      setJobStatus('failed')
      setJobError('Pilih rentang tanggal settlement terlebih dahulu.')
      return
    }

    const payload = {
      subMerchantId: selectedSubMerchant,
      toWibStart: toWibStart(startDate).toISOString(),
      toWibExclusiveEnd: toWibExclusiveEnd(endDate).toISOString(),
    }

    setJobStatus('starting')

    try {
      const { data } = await apiClient.post<{ jobId?: string; id?: string }>(
        '/admin/settlement/adjust/job',
        payload
      )

      const nextJobId = data?.jobId ?? data?.id ?? ''
      if (!nextJobId) {
        throw new Error('Job ID tidak ditemukan pada respons backend')
      }

      setJobId(nextJobId)
      setJobStatus('queued')
      setJobSummary({ message: 'Job settlement adjust telah dimulai.' })
      stopPolling()
      void pollStatus(nextJobId)
      schedulePolling(nextJobId)
    } catch (err: any) {
      stopPolling()
      setJobStatus('failed')
      setJobId('')
      setJobError(
        err?.response?.data?.error ??
          err?.message ??
          'Gagal memulai job settlement adjust'
      )
    }
  }, [apiClient, endDate, pollStatus, schedulePolling, selectedSubMerchant, startDate, stopPolling])

  const isRunning = jobStatus === 'starting' || jobStatus === 'queued' || jobStatus === 'running'
  const canStart = Boolean(selectedSubMerchant && startDate && endDate) && !isRunning
  const statusLabel =
    jobStatus === 'idle' || jobStatus === 'starting'
      ? 'Belum berjalan'
      : JOB_STATUS_LABEL[jobStatus] ?? 'Tidak diketahui'

  const progressText = useMemo(() => {
    if (jobSummary.processed != null && jobSummary.total != null) {
      return `${jobSummary.processed.toLocaleString('id-ID')} / ${jobSummary.total.toLocaleString(
        'id-ID'
      )}`
    }
    if (jobSummary.processed != null) {
      return `${jobSummary.processed.toLocaleString('id-ID')} diproses`
    }
    if (jobSummary.total != null) {
      return `${jobSummary.total.toLocaleString('id-ID')} target`
    }
    return ''
  }, [jobSummary.processed, jobSummary.total])

  return (
    <div className="mt-6 space-y-3 rounded-2xl border border-indigo-900/40 bg-indigo-950/20 p-4 text-sm text-neutral-100">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wide text-neutral-400">Penandaan Otomatis</div>
        <p className="text-neutral-300">
          Mulai job untuk menandai transaksi settlement sebagai selesai agar workflow reversal dapat
          melihat update terbaru.
        </p>
      </div>
      <button
        onClick={startJob}
        disabled={!canStart}
        className={`inline-flex items-center gap-2 self-start rounded-xl px-4 py-2 text-sm font-semibold transition ${
          canStart
            ? 'bg-indigo-600 text-white hover:bg-indigo-500'
            : 'cursor-not-allowed bg-neutral-800 text-neutral-500'
        }`}
      >
        {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isRunning ? 'Memproses…' : 'Mulai Penandaan Settlement'}
      </button>
      {jobId && (
        <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/40 p-3 text-xs text-indigo-100">
          <div className="font-semibold text-indigo-200">Job ID: {jobId}</div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-indigo-100/90">
            <span>Status: {statusLabel}</span>
            {progressText ? <span>Progres: {progressText}</span> : null}
            {jobSummary.message ? <span>{jobSummary.message}</span> : null}
          </div>
          {jobSummary.updatedCount != null && jobStatus === 'completed' && (
            <div className="mt-2 text-[13px] text-emerald-200">
              {jobSummary.updatedCount.toLocaleString('id-ID')} transaksi settlement diperbarui.
            </div>
          )}
          {jobSummary.updatedIds && jobSummary.updatedIds.length > 0 && (
            <div className="mt-2 space-y-1 text-[11px] text-indigo-100/80">
              <div className="uppercase tracking-wide text-indigo-300">Order yang diperbarui</div>
              <ul className="grid grid-cols-1 gap-1 font-mono text-[11px] sm:grid-cols-2">
                {jobSummary.updatedIds.map(id => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            </div>
          )}
          {jobSummary.errors && jobSummary.errors.length > 0 && (
            <div className="mt-2 space-y-1 text-[11px] text-amber-200">
              <div className="uppercase tracking-wide text-amber-300">Error detail</div>
              <ul className="space-y-1">
                {jobSummary.errors.map((err, index) => (
                  <li key={`${err.id ?? 'error'}-${index}`}>
                    <span className="font-mono text-amber-100">{err.id ?? '—'}</span>: {err.message ?? 'Terjadi kesalahan'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {jobError && (
        <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-xs text-rose-200">
          {jobError}
        </div>
      )}
      {!jobId && jobStatus === 'failed' && !jobError && (
        <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-xs text-rose-200">
          Job settlement adjust gagal dijalankan.
        </div>
      )}
    </div>
  )
}

export default function SettlementAdjustPage() {
  useRequireAuth()

  const [isAdmin, setIsAdmin] = useState(false)

  // Pastikan portal untuk DatePicker tersedia di <body>
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    let portal = document.getElementById(DATEPICKER_PORTAL_ID)
    if (!portal) {
      portal = document.createElement('div')
      portal.id = DATEPICKER_PORTAL_ID
      document.body.appendChild(portal)
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    const payload = parseJwt(token)
    if (!payload?.role) return
    const role = String(payload.role).toUpperCase()
    setIsAdmin(role === 'ADMIN' || role === 'SUPER_ADMIN')
  }, [])

  const defaultRange: [Date | null, Date | null] = useMemo(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 6)
    return [start, end]
  }, [])

  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>(defaultRange)
  const [selectedSubMerchant, setSelectedSubMerchant] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [subMerchants, setSubMerchants] = useState<SubMerchantOption[]>([])
  const subMerchantNameMap = useMemo(
    () => Object.fromEntries(subMerchants.map(sub => [sub.id, sub.name ?? null])),
    [subMerchants]
  )
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [subsError, setSubsError] = useState('')

  const [rows, setRows] = useState<SettlementRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [rowsError, setRowsError] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize] = useState(DEFAULT_PAGE_SIZE)
  const [totalCount, setTotalCount] = useState(0)

  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const [showConfirm, setShowConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [toast, setToast] = useState<ToastState>(null)
  const [errorList, setErrorList] = useState<{ id?: string; message?: string }[]>([])

  const [datePickerRange, setDatePickerRange] = useState<[Date | null, Date | null]>(defaultRange)

  const requestIdRef = useRef(0)

  useEffect(() => {
    setDatePickerRange(dateRange)
  }, [dateRange])

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 400)
    return () => window.clearTimeout(id)
  }, [searchTerm])

  useEffect(() => {
    let cancelled = false
    async function loadSubMerchants() {
      setLoadingSubs(true)
      setSubsError('')
      try {
        const { data } = await api.get<{ subBalances?: { id: string; name?: string | null }[] }>(
          '/admin/merchants/all/balances'
        )
        if (cancelled) return
        const options = (data.subBalances ?? []).map(sub => ({ id: sub.id, name: sub.name }))
        setSubMerchants(options)
      } catch (err: any) {
        if (cancelled) return
        setSubsError(err?.response?.data?.error ?? 'Gagal memuat daftar sub-merchant')
      } finally {
        if (cancelled) return
        setLoadingSubs(false)
      }
    }
    loadSubMerchants()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, selectedSubMerchant, dateRange])

  useEffect(() => {
    setSelectedIds([])
    if (!selectedSubMerchant) {
      setRows([])
      setTotalCount(0)
      setRowsError('')
      setLoadingRows(false)
    }
  }, [selectedSubMerchant])

  const fetchRows = useCallback(
    async (targetPage: number) => {
      const requestId = ++requestIdRef.current
      const [start, end] = dateRange
      if (!start || !end || !selectedSubMerchant) {
        setRows([])
        setTotalCount(0)
        setRowsError('')
        setLoadingRows(false)
        return
      }

      setRowsError('')
      setLoadingRows(true)

      const params: Record<string, any> = {
        subMerchantId: selectedSubMerchant,
        settled_from: toWibStart(start).toISOString(),
        settled_to: toWibExclusiveEnd(end).toISOString(),
        page: targetPage,
        size: pageSize,
        sort: '-settlementTime',
      }
      if (debouncedSearch) params.q = debouncedSearch

      try {
        const { data } = await api.get<any>('/admin/settlement/eligible', { params })
        if (requestId !== requestIdRef.current) return
        const listSource = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []

        const mapped: SettlementRow[] = []
        for (const raw of listSource) {
          const id = String(raw?.id ?? '')
          const subMerchantId = String(
            raw?.subMerchantId ?? raw?.sub_merchant_id ?? raw?.partnerClientId ?? ''
          )
          const settlementTimeSource = raw?.settlementTime ?? raw?.settlement_time ?? null
          if (!id || !subMerchantId || !settlementTimeSource) {
            continue
          }

          const settlementTime = new Date(settlementTimeSource)
          if (Number.isNaN(settlementTime.getTime())) {
            continue
          }

          const settlementAmount = raw?.settlementAmount ?? raw?.settlement_amount ?? null
          const amount = raw?.amount ?? null
          const feeLauncx = raw?.feeLauncx ?? raw?.fee_launcx ?? null
          const fee3rdParty = raw?.fee3rdParty ?? raw?.fee3rd_party ?? raw?.fee_3rd_party ?? null

          mapped.push({
            id,
            subMerchantId,
            subMerchantName: subMerchantNameMap[subMerchantId] ?? null,
            status: String(raw?.status ?? ''),
            settlementTime: settlementTime.toISOString(),
            settlementAmount: settlementAmount != null ? Number(settlementAmount) : null,
            amount: amount != null ? Number(amount) : null,
            feeLauncx: feeLauncx != null ? Number(feeLauncx) : null,
            fee3rdParty: fee3rdParty != null ? Number(fee3rdParty) : null,
          })
        }

        const reportedTotal = typeof data?.total === 'number' ? data.total : null

        if (requestId === requestIdRef.current && targetPage > 1 && mapped.length === 0 && reportedTotal && reportedTotal > 0) {
          setPage(1)
          // Kadang API ngelaporin halaman > real; refetch page 1 biar tabel gak kosong.
          window.setTimeout(() => {
            if (requestId === requestIdRef.current) {
              fetchRows(1)
            }
          }, 0)
          return
        }

        setRows(mapped)
        setTotalCount(reportedTotal ?? mapped.length)
        setPage(mapped.length > 0 || targetPage === 1 ? targetPage : 1)
      } catch (err: any) {
        if (requestId !== requestIdRef.current) return
        if (err?.response?.status === 404) {
          setRowsError('Endpoint data settlement belum tersedia.')
        } else {
          setRowsError(err?.response?.data?.error ?? 'Gagal memuat data settlement')
        }
        setRows([])
        setTotalCount(0)
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingRows(false)
        }
      }
    },
    [dateRange, debouncedSearch, pageSize, selectedSubMerchant, subMerchantNameMap]
  )

  useEffect(() => {
    const [start, end] = dateRange
    if (!start || !end || !selectedSubMerchant) return
    fetchRows(1)
  }, [dateRange, debouncedSearch, selectedSubMerchant, fetchRows])

  useEffect(() => {
    setSelectedIds(prev => prev.filter(id => rows.some(row => row.id === id)))
  }, [rows])

  const selectableRows = useMemo(() => rows.map(row => row.id), [rows])
  const allSelected = selectableRows.length > 0 && selectableRows.every(id => selectedIds.includes(id))

  const selectionSummary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        if (selectedIds.includes(row.id)) {
          acc.count += 1
          acc.total += computeReversalPreview(row)
        }
        return acc
      },
      { count: 0, total: 0 }
    )
  }, [rows, selectedIds])

  const onToggleAll = () => {
    if (allSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(selectableRows)
    }
  }

  const onToggleOne = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]))
  }

  const onChangeRange = (dates: [Date | null, Date | null]) => {
    const [start, end] = dates
    setDatePickerRange(dates)
    if (start && end) {
      setDateRange([start, end])
    }
  }

  const onResetRange = () => {
    const [start, end] = defaultRange
    if (start && end) {
      const nextRange: [Date, Date] = [new Date(start), new Date(end)]
      setDateRange(nextRange)
      setDatePickerRange(nextRange)
    }
  }

  const onConfirmReverse = async () => {
    if (!selectedIds.length || !selectedSubMerchant) return
    setSubmitting(true)
    setToast(null)
    setErrorList([])
    try {
      const payload: { orderIds: string[]; subMerchantId: string; reason?: string } = {
        orderIds: selectedIds,
        subMerchantId: selectedSubMerchant,
      }
      if (reason.trim()) payload.reason = reason.trim()

      const { data } = await api.post<ReversalResponse>(
        '/admin/settlement/reverse-to-ln-settle',
        payload
      )

      const processed = data?.processed ?? selectedIds.length
      const ok = data?.ok ?? processed
      const fail = data?.fail ?? 0
      const totalReversalAmount = data?.totalReversalAmount ?? selectionSummary.total
      const errors = Array.isArray(data?.errors) ? data.errors : []
      setErrorList(errors)

      const resultType = fail > 0 || errors.length > 0 ? 'warning' : 'success'
      const title = fail > 0 ? 'Sebagian reversal gagal' : 'Reversal berhasil'
      const message = `Processed ${processed} order (OK: ${ok}, Fail: ${fail}). Total reversal ${formatCurrency(
        totalReversalAmount
      )}`

      setToast({ type: resultType, title, message })
      setShowConfirm(false)
      setReason('')
      setSelectedIds([])
      fetchRows(1)
    } catch (err: any) {
      if (err?.response?.status === 404 || err?.response?.status >= 500) {
        setToast({
          type: 'error',
          title: 'Reversal tidak tersedia',
          message: 'Endpoint reversal belum tersedia, hubungi backend.',
        })
      } else {
        setToast({
          type: 'error',
          title: 'Reversal gagal',
          message: err?.response?.data?.error ?? err?.message ?? 'Gagal melakukan reversal',
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const totalPages = useMemo(() => {
    return totalCount > 0 ? Math.ceil(totalCount / pageSize) : 1
  }, [totalCount, pageSize])

  const canReverse = isAdmin && Boolean(selectedSubMerchant) && selectionSummary.count > 0

  return (
    <div className="min-h-screen bg-neutral-950 px-4 py-6 text-neutral-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Settlement Adjustment</h1>
          <p className="text-sm text-neutral-400">
            Cari transaksi yang sudah disettle dan lakukan reversal ke status <code>LN_SETTLE</code>.
          </p>
        </header>

        {toast && (
          <div
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lg ${
              toast.type === 'success'
                ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-200'
                : toast.type === 'warning'
                ? 'border-amber-900/40 bg-amber-950/40 text-amber-200'
                : 'border-rose-900/40 bg-rose-950/40 text-rose-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : toast.type === 'warning' ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <ShieldAlert className="h-5 w-5" />
            )}
            <div className="space-y-1">
              <div className="font-medium">{toast.title}</div>
              <div>{toast.message}</div>
              {toast.detail && <div className="text-xs opacity-80">{toast.detail}</div>}
            </div>
          </div>
        )}

        {errorList.length > 0 && (
          <div className="rounded-2xl border border-amber-900/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" /> Detail error reversal
            </div>
            <ul className="space-y-1 text-xs">
              {errorList.map((err, idx) => (
                <li key={`${err.id ?? idx}-${idx}`} className="flex items-center gap-2">
                  <span className="font-mono text-amber-200">{err.id ?? '—'}</span>
                  <span className="text-amber-100/80">{err.message ?? 'Terjadi kesalahan pada order ini'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,240px)_minmax(0,1fr)_minmax(0,200px)]">
            <div className="flex flex-col gap-1">
              <label className="text-xs uppercase tracking-wide text-neutral-400">Sub-merchant</label>
              <select
                value={selectedSubMerchant}
                onChange={event => setSelectedSubMerchant(event.target.value)}
                className="h-11 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40"
              >
                <option value="">Pilih sub-merchant</option>
                {subMerchants.map(sub => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name ?? sub.id}
                  </option>
                ))}
              </select>
              {loadingSubs && <span className="text-[11px] text-neutral-500">Memuat sub-merchant…</span>}
              {subsError && <span className="text-[11px] text-rose-400">{subsError}</span>}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs uppercase tracking-wide text-neutral-400">Settlement Date range</label>
              <DatePicker
                selectsRange
                startDate={datePickerRange[0]}
                endDate={datePickerRange[1]}
                onChange={onChangeRange}
                shouldCloseOnSelect={false}
                maxDate={new Date()}
                dateFormat="dd MMM yyyy"
                // === FIX: render calendar ke portal di <body> agar tidak ketutup ===
                withPortal
                portalId={DATEPICKER_PORTAL_ID}
                popperProps={{ strategy: 'fixed' }}
                popperClassName="datepicker-popper"
                calendarClassName="dp-dark"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40"
              />
              <button
                onClick={onResetRange}
                className="self-start text-[11px] text-neutral-400 underline hover:text-neutral-200"
              >
                Reset ke 7 hari terakhir
              </button>
            </div>

            <div className="flex flex-col gap-1 md:col-span-2">
              <label className="text-xs uppercase tracking-wide text-neutral-400">Cari Order ID / RRN</label>
              <input
                type="text"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder="Masukkan Order ID / kata kunci"
                className="h-11 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40"
              />
              <span className="text-[11px] text-neutral-500">Pencarian berdasarkan Order ID atau RRN, otomatis setelah berhenti mengetik.</span>
            </div>
          </div>

          <SettlementAdjustJobControl
            selectedSubMerchant={selectedSubMerchant}
            dateRange={dateRange}
            onJobFinished={() => fetchRows(1)}
          />
        </section>

        <section className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-neutral-400">
              {!selectedSubMerchant
                ? 'Pilih Sub-merchant untuk mulai.'
                : loadingRows
                ? 'Memuat data…'
                : `${totalCount.toLocaleString('id-ID')} order ditemukan`}
            </div>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <div className="rounded-full border border-indigo-900/40 bg-indigo-950/40 px-3 py-1 text-indigo-200">
                Dipilih: {selectionSummary.count} order
              </div>
              <div className="rounded-full border border-indigo-900/40 bg-indigo-950/40 px-3 py-1 text-indigo-200">
                Total reversal: {formatCurrency(selectionSummary.total)}
              </div>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={!canReverse}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  canReverse
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'cursor-not-allowed bg-neutral-800 text-neutral-500'
                }`}
              >
                Reverse to LN_SETTLE
              </button>
            </div>
          </div>

          {!isAdmin && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
              Hanya admin yang dapat melakukan reversal. Hubungi administrator jika membutuhkan akses.
            </div>
          )}

          {rowsError && (
            <div className="rounded-2xl border border-rose-900/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
              {rowsError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-800 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="whitespace-nowrap px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={onToggleAll}
                      className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-indigo-500"
                      disabled={!rows.length || !isAdmin || !selectedSubMerchant}
                    />
                  </th>
                  <th className="whitespace-nowrap px-3 py-2">Order ID</th>
                  <th className="whitespace-nowrap px-3 py-2">Sub-Merchant</th>
                  <th className="whitespace-nowrap px-3 py-2">Status</th>
                  <th className="whitespace-nowrap px-3 py-2">Settlement Time</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Settlement Amount</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Amount</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Fee Launcx</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Fee 3rd Party</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {loadingRows && (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-neutral-400">
                      <span className="inline-flex items-center gap-2 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Memuat data settlement…
                      </span>
                    </td>
                  </tr>
                )}
                {!loadingRows && !selectedSubMerchant && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-neutral-500">
                      Pilih Sub-merchant untuk mulai.
                    </td>
                  </tr>
                )}
                {!loadingRows && selectedSubMerchant && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-neutral-500">
                      Tidak ada transaksi settled pada rentang tanggal ini.
                    </td>
                  </tr>
                )}
                {!loadingRows &&
                  rows.map(row => {
                    const isChecked = selectedIds.includes(row.id)
                    const settlementFormatted = row.settlementTime
                      ? dayjs(row.settlementTime).tz(WIB).format('DD MMM YYYY HH:mm')
                      : '—'
                    return (
                      <tr key={row.id} className="transition hover:bg-neutral-900/60">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleOne(row.id)}
                            className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-indigo-500"
                            disabled={!isAdmin}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-sm text-indigo-200">{row.id}</td>
                        <td className="px-3 py-2 text-sm text-neutral-200">
                          {row.subMerchantName ?? row.subMerchantId}
                        </td>
                        <td className="px-3 py-2 text-xs uppercase">
                          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-900/40 bg-emerald-950/40 px-3 py-1 text-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                            {row.status || 'SETTLED'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-neutral-200">{settlementFormatted}</td>
                        <td className="px-3 py-2 text-right text-sm text-neutral-100">
                          {formatCurrency(row.settlementAmount ?? computeReversalPreview(row))}
                        </td>
                        <td className="px-3 py-2 text-right text-sm text-neutral-400">
                          {formatCurrency(row.amount ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-right text-sm text-neutral-400">
                          {formatCurrency(row.feeLauncx ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-right text-sm text-neutral-400">
                          {formatCurrency(row.fee3rdParty ?? 0)}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-neutral-500">
            <div>
              Halaman {page} dari {totalPages} (maks {pageSize.toLocaleString('id-ID')} order/halaman)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchRows(Math.max(1, page - 1))}
                disabled={page <= 1 || loadingRows || !selectedSubMerchant}
                className="rounded-lg border border-neutral-800 px-3 py-1 text-neutral-300 transition hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sebelumnya
              </button>
              <button
                onClick={() => fetchRows(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages || loadingRows || !selectedSubMerchant}
                className="rounded-lg border border-neutral-800 px-3 py-1 text-neutral-300 transition hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Selanjutnya
              </button>
            </div>
          </div>
        </section>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl">
            <div className="mb-4 space-y-1">
              <h2 className="text-lg font-semibold text-white">Konfirmasi reversal</h2>
              <p className="text-sm text-neutral-400">
                Reversal akan mengubah status menjadi <code>LN_SETTLE</code>, mengosongkan settlement time & amount,
                serta mengurangi Available Withdraw client.
              </p>
            </div>

            <div className="space-y-3 text-sm text-neutral-200">
              <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
                <span>Order terpilih</span>
                <span className="font-semibold text-white">{selectionSummary.count} order</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
                <span>Total reversal amount</span>
                <span className="font-semibold text-white">{formatCurrency(selectionSummary.total)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs uppercase tracking-wide text-neutral-400">Reason (opsional)</label>
                <textarea
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  rows={4}
                  placeholder="Catatan tambahan untuk backend"
                  className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
              <div className="rounded-xl border border-amber-900/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                Reversal akan mengurangi Available Withdraw client.
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  if (!submitting) {
                    setShowConfirm(false)
                  }
                }}
                className="inline-flex items-center justify-center rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-neutral-600"
                disabled={submitting}
              >
                Batal
              </button>
              <button
                onClick={onConfirmReverse}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? 'Memproses…' : 'Konfirmasi Reversal'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        /* Pastikan popper selalu di atas & bebas dari overflow parent */
        .datepicker-popper.react-datepicker-popper { 
          z-index: 2147483647 !important; 
          position: fixed !important;
        }
        .dp-dark.react-datepicker {
          background-color: #0a0a0a; border: 1px solid #262626; color: #e5e5e5;
        }
        .dp-dark .react-datepicker__header {
          background-color: #111111; border-bottom: 1px solid #262626;
        }
        .dp-dark .react-datepicker__current-month,
        .dp-dark .react-datepicker-time__header,
        .dp-dark .react-datepicker-year-header,
        .dp-dark .react-datepicker__day-name { color: #d4d4d4; }
        .dp-dark .react-datepicker__day { color: #e5e5e5; }
        .dp-dark .react-datepicker__day--outside-month { color: #737373; }
        .dp-dark .react-datepicker__day--keyboard-selected,
        .dp-dark .react-datepicker__day--selected,
        .dp-dark .react-datepicker__day--in-range {
          background-color: #4f46e5; color: #fff;
        }
      `}</style>
    </div>
  )
}
