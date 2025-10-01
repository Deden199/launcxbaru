'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import DatePicker from 'react-datepicker'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { AlertCircle, CheckCircle, Loader2, RefreshCcw } from 'lucide-react'

import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import type { SubBalance } from '@/types/dashboard'

dayjs.extend(utc)
dayjs.extend(timezone)

if (typeof window !== 'undefined') {
  void import('react-datepicker/dist/react-datepicker.css')
}

export const toWibIso = (date: Date) => dayjs(date).tz('Asia/Jakarta', true).toDate().toISOString()

export const MAX_LOAN_PAGE_SIZE = 1500
export const DEFAULT_LOAN_PAGE_SIZE = MAX_LOAN_PAGE_SIZE
const PAGE_SIZE_OPTIONS = [100, 250, 500, 1000, MAX_LOAN_PAGE_SIZE]

const SUPPORTED_LOAN_STATUSES = ['PAID', 'SUCCESS', 'DONE', 'SETTLED', 'LN_SETTLED'] as const
const SELECTABLE_LOAN_STATUSES = ['PAID', 'SUCCESS', 'DONE', 'SETTLED'] as const
const SELECTABLE_LOAN_STATUS_LABEL = SELECTABLE_LOAN_STATUSES.join('/')
const SELECTABLE_LOAN_STATUS_TEXT =
  SELECTABLE_LOAN_STATUSES.length > 1
    ? `${SELECTABLE_LOAN_STATUSES.slice(0, -1).join(', ')} atau ${
        SELECTABLE_LOAN_STATUSES[SELECTABLE_LOAN_STATUSES.length - 1]
      }`
    : SELECTABLE_LOAN_STATUSES[0]

type LoanTransactionStatus = (typeof SUPPORTED_LOAN_STATUSES)[number]

const isSupportedLoanStatus = (value: unknown): value is LoanTransactionStatus =>
  typeof value === 'string' && SUPPORTED_LOAN_STATUSES.includes(value as LoanTransactionStatus)

const isSelectableLoanStatus = (status: LoanTransactionStatus) =>
  SELECTABLE_LOAN_STATUSES.includes(status as (typeof SELECTABLE_LOAN_STATUSES)[number])

type LoanTransaction = {
  id: string
  amount: number
  pendingAmount: number
  status: LoanTransactionStatus
  createdAt: string
  loanedAt: string | null
  loanAmount: number | null
  loanCreatedAt: string | null
}

const LOAN_STATUS_BADGE_META: Record<LoanTransactionStatus, { label: string; className: string; title?: string }> = {
  PAID: {
    label: 'Paid',
    className: 'bg-indigo-950/40 text-indigo-300 border border-indigo-900/40',
  },
  SUCCESS: {
    label: 'Success',
    className: 'bg-sky-950/40 text-sky-200 border border-sky-900/40',
    title: 'Success: transaksi sukses oleh gateway dan siap diproses loan-settled.',
  },
  DONE: {
    label: 'Done',
    className: 'bg-emerald-950/40 text-emerald-200 border border-emerald-900/40',
    title: 'Done: transaksi selesai dan siap ditandai sebagai loan-settled.',
  },
  SETTLED: {
    label: 'Settled',
    className: 'bg-teal-950/40 text-teal-200 border border-teal-900/40',
    title: 'Settled: transaksi diselesaikan oleh sistem settlement dan siap loan-settled.',
  },
  LN_SETTLED: {
    label: 'Loan Settled',
    className: 'bg-purple-950/40 text-purple-200 border border-purple-900/40',
    title:
      'Loan-settled: transaksi ditandai sebagai pelunasan pinjaman/manual, tidak ikut proses settlement.',
  },
}

type LoanSettlementSummary = {
  ok: string[]
  fail: string[]
  errors: { orderId: string; message: string }[]
}

type LoanSettlementJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface LoanPageViewProps {
  apiClient?: typeof api
  initialRange?: [Date | null, Date | null]
}

const formatCurrency = (value: number) =>
  value.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })

const formatDateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('id-ID', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '-'

function LoanStatusBadge({ status }: { status: LoanTransaction['status'] }) {
  const metaEntry = LOAN_STATUS_BADGE_META[status] ?? LOAN_STATUS_BADGE_META.PAID

  return (
    <span
      title={metaEntry.title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase ${metaEntry.className}`}
    >
      {metaEntry.label}
    </span>
  )
}

export function LoanPageView({ apiClient = api, initialRange }: LoanPageViewProps) {
  const [subMerchants, setSubMerchants] = useState<SubBalance[]>([])
  const [loadingSubs, setLoadingSubs] = useState(true)
  const [subsError, setSubsError] = useState('')
  const [selectedSub, setSelectedSub] = useState('')

  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>(() => {
    if (initialRange) return initialRange
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 6)
    return [start, end]
  })
  const [transactions, setTransactions] = useState<LoanTransaction[]>([])
  const [loadingTx, setLoadingTx] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [txError, setTxError] = useState('')
  const [formError, setFormError] = useState('')

  const [selectedOrders, setSelectedOrders] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const [startingJob, setStartingJob] = useState(false)
  const [rangeJobId, setRangeJobId] = useState('')
  const [rangeJobStatus, setRangeJobStatus] = useState<LoanSettlementJobStatus | ''>('')
  const [rangeJobSummary, setRangeJobSummary] = useState<LoanSettlementSummary | null>(null)
  const [rangeJobError, setRangeJobError] = useState('')
  const jobPollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [requestedPageSize, setRequestedPageSize] = useState(DEFAULT_LOAN_PAGE_SIZE)
  const [effectivePageSize, setEffectivePageSize] = useState(DEFAULT_LOAN_PAGE_SIZE)
  const [rawTotalCount, setRawTotalCount] = useState(0)
  const [lastLoadedPage, setLastLoadedPage] = useState(0)

  const [startDate, endDate] = dateRange

  const pageSizeOptions = useMemo(() => {
    const unique = new Set<number>(PAGE_SIZE_OPTIONS)
    unique.add(requestedPageSize)
    unique.add(effectivePageSize)
    return Array.from(unique).sort((a, b) => a - b)
  }, [effectivePageSize, requestedPageSize])

  useEffect(() => {
    let cancelled = false
    async function fetchSubMerchants() {
      setSubsError('')
      setLoadingSubs(true)
      try {
        const { data } = await apiClient.get<{ subBalances: SubBalance[] }>(
          '/admin/merchants/all/balances'
        )
        if (cancelled) return
        setSubMerchants(data.subBalances ?? [])
      } catch (err: any) {
        if (cancelled) return
        setSubsError(err?.response?.data?.error ?? 'Gagal memuat daftar sub-merchant')
      } finally {
        if (cancelled) return
        setLoadingSubs(false)
      }
    }
    fetchSubMerchants()
    return () => {
      cancelled = true
    }
  }, [apiClient])

  const displayedTransactions = useMemo(
    () => transactions.filter(tx => isSelectableLoanStatus(tx.status)),
    [transactions]
  )

  useEffect(() => {
    setSelectedOrders(prev =>
      prev.filter(id => displayedTransactions.some(tx => tx.id === id))
    )
  }, [displayedTransactions])

  useEffect(() => {
    return () => {
      if (jobPollTimeout.current) {
        clearTimeout(jobPollTimeout.current)
      }
    }
  }, [])

  const selectableIds = useMemo(
    () => displayedTransactions.map(tx => tx.id),
    [displayedTransactions]
  )

  const totalPending = useMemo(
    () => displayedTransactions.reduce((sum, tx) => sum + (tx.pendingAmount ?? 0), 0),
    [displayedTransactions]
  )
  const totalLoanAmount = useMemo(
    () => displayedTransactions.reduce((sum, tx) => sum + (tx.loanAmount ?? 0), 0),
    [displayedTransactions]
  )
  const selectedSummary = useMemo(() => {
    return displayedTransactions.reduce(
      (acc, tx) => {
        if (selectedOrders.includes(tx.id)) {
          acc.count += 1
          acc.pending += tx.pendingAmount ?? 0
          acc.loan += tx.loanAmount ?? 0
        }
        return acc
      },
      { count: 0, pending: 0, loan: 0 }
    )
  }, [selectedOrders, displayedTransactions])

  const fetchTransactions = async (targetPage: number, append: boolean) => {
    if (!selectedSub || !startDate || !endDate) return

    const params = {
      subMerchantId: selectedSub,
      startDate: toWibIso(startDate),
      endDate: toWibIso(endDate),
      page: targetPage,
      pageSize: requestedPageSize,
    }

    if (append) {
      setLoadingMore(true)
    } else {
      setLoadingTx(true)
    }

    try {
      const { data } = await apiClient.get<{
        data: any[]
        meta?: { total?: number; page?: number; pageSize?: number }
      }>('/admin/merchants/loan/transactions', {
        params,
      })

      const rawList = Array.isArray(data.data) ? data.data : []
      const mapped: LoanTransaction[] = rawList.map((raw) => {
        const rawStatus: unknown = raw.status
        const status: LoanTransactionStatus = isSupportedLoanStatus(rawStatus)
          ? rawStatus
          : 'PAID'

        return {
          id: raw.id,
          amount: raw.amount ?? 0,
          pendingAmount: raw.pendingAmount ?? 0,
          status,
          createdAt: raw.createdAt,
          loanedAt: raw.loanedAt ?? null,
          loanAmount: raw.loanAmount ?? null,
          loanCreatedAt: raw.loanCreatedAt ?? null,
        }
      })

      setTransactions(prev => (append ? [...prev, ...mapped] : mapped))
      setRawTotalCount(prev => data.meta?.total ?? (append ? prev : mapped.length))
      const resolvedPageSize = data.meta?.pageSize ?? requestedPageSize
      setEffectivePageSize(resolvedPageSize)
      setRequestedPageSize(resolvedPageSize)
      setLastLoadedPage(data.meta?.page ?? targetPage)

      if (!append) {
        setSelectedOrders([])
      }
    } catch (err: any) {
      setTxError(err?.response?.data?.error ?? 'Gagal memuat transaksi loan')
    } finally {
      if (append) {
        setLoadingMore(false)
      } else {
        setLoadingTx(false)
      }
    }
  }

  const loadTransactions = async () => {
    setFormError('')
    setTxError('')

    if (!selectedSub) {
      setFormError('Pilih sub-merchant terlebih dahulu.')
      return
    }
    if (!startDate || !endDate) {
      setFormError('Pilih rentang tanggal terlebih dahulu.')
      return
    }

    setRawTotalCount(0)
    setLastLoadedPage(0)
    await fetchTransactions(1, false)
  }

  const loadMoreTransactions = async () => {
    if (loadingMore || loadingTx) return
    if (!selectedSub || !startDate || !endDate) return
    if (transactions.length >= rawTotalCount) return

    setTxError('')
    await fetchTransactions(lastLoadedPage + 1, true)
  }

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedOrders(selectableIds)
    } else {
      setSelectedOrders([])
    }
  }

  const toggleOne = (id: string, checked: boolean, disabled: boolean) => {
    if (disabled) return
    setSelectedOrders(prev =>
      checked ? [...prev, id] : prev.filter(item => item !== id)
    )
  }

  const clearJobPolling = () => {
    if (jobPollTimeout.current) {
      clearTimeout(jobPollTimeout.current)
      jobPollTimeout.current = null
    }
  }

  const pollJobStatus = async (jobId: string) => {
    const scheduleNext = () => {
      clearJobPolling()
      jobPollTimeout.current = setTimeout(() => {
        void pollJobStatus(jobId)
      }, 1500)
    }

    try {
      const { data } = await apiClient.get<{
        jobId: string
        status: LoanSettlementJobStatus
        summary?: LoanSettlementSummary
        error?: string | null
      }>(`/admin/merchants/loan/mark-settled/by-range/status/${jobId}`)

      const summary: LoanSettlementSummary = data.summary ?? {
        ok: [],
        fail: [],
        errors: [],
      }
      setRangeJobId(data.jobId)
      setRangeJobSummary(summary)
      setRangeJobStatus(data.status)
      setRangeJobError('')

      if (data.status === 'completed') {
        clearJobPolling()
        if (summary.ok.length > 0) {
          setActionMessage(`Berhasil menandai ${summary.ok.length} transaksi sebagai loan-settled.`)
        } else {
          setActionMessage('Tidak ada perubahan status yang dilakukan.')
        }

        if (summary.fail.length > 0) {
          const detail = summary.errors
            .map(err => `${err.orderId ?? 'unknown'}: ${err.message}`)
            .join('; ')
          setActionError(`Gagal menandai ${summary.fail.length} transaksi: ${detail}`)
        } else {
          setActionError('')
          if (summary.ok.length > 0 && noteRef.current) {
            noteRef.current.value = ''
          }
        }

        void loadTransactions()
      } else if (data.status === 'failed') {
        clearJobPolling()
        const message = data.error ?? 'Job penandaan loan-settled gagal dijalankan.'
        setRangeJobError(message)
        setActionError(message)
        setActionMessage('')
      } else {
        setActionMessage('Proses penandaan sedang dijalankan…')
        setActionError('')
        scheduleNext()
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error ?? 'Gagal memeriksa status job loan-settled'
      setRangeJobError(message)
      setActionError(message)
      setActionMessage('')
      scheduleNext()
    }
  }

  const startRangeSettlement = async () => {
    setFormError('')
    setActionError('')
    setActionMessage('')
    setRangeJobError('')

    if (!selectedSub) {
      setFormError('Pilih sub-merchant terlebih dahulu.')
      return
    }
    if (!startDate || !endDate) {
      setFormError('Pilih rentang tanggal terlebih dahulu.')
      return
    }

    const payload: {
      subMerchantId: string
      startDate: string
      endDate: string
      note?: string
    } = {
      subMerchantId: selectedSub,
      startDate: toWibIso(startDate),
      endDate: toWibIso(endDate),
    }

    const trimmedNote = (noteRef.current?.value ?? '').trim()
    if (trimmedNote) {
      payload.note = trimmedNote
    }

    setStartingJob(true)
    try {
      const { data } = await apiClient.post<{ jobId?: string }>(
        '/admin/merchants/loan/mark-settled/by-range/start',
        payload,
      )

      const jobId = data?.jobId
      if (!jobId) {
        throw new Error('Missing jobId')
      }

      setRangeJobId(jobId)
      setRangeJobStatus('queued')
      setRangeJobSummary({ ok: [], fail: [], errors: [] })
      setActionMessage('Proses penandaan sedang dijalankan…')
      setActionError('')
      clearJobPolling()
      jobPollTimeout.current = setTimeout(() => {
        void pollJobStatus(jobId)
      }, 1000)
    } catch (err: any) {
      clearJobPolling()
      setRangeJobId('')
      setRangeJobStatus('')
      setRangeJobSummary(null)
      const message =
        err?.response?.data?.error ?? 'Gagal memulai job penandaan loan-settled'
      setRangeJobError(message)
      setActionError(message)
    } finally {
      setStartingJob(false)
    }
  }

  const settleSelected = async () => {
    setFormError('')
    setActionError('')

    if (!selectedSub) {
      setFormError('Pilih sub-merchant terlebih dahulu.')
      return
    }
    if (selectedOrders.length === 0) {
      setFormError(
        `Pilih minimal satu transaksi berstatus ${SELECTABLE_LOAN_STATUS_TEXT}.`
      )
      return
    }

    setSubmitting(true)
    try {
      const payload: { orderIds: string[]; note?: string } = { orderIds: selectedOrders }
      const trimmedNote = (noteRef.current?.value ?? '').trim()
      if (trimmedNote) {
        payload.note = trimmedNote
      }

      const { data } = await apiClient.post<{
        ok?: string[]
        fail?: string[]
        errors?: { orderId: string; message: string }[]
      }>('/admin/merchants/loan/mark-settled', payload)

      await loadTransactions()

      const ok = data?.ok ?? []
      const fail = data?.fail ?? []
      const errors = data?.errors ?? []

      if (ok.length > 0) {
        setActionMessage(`Berhasil menandai ${ok.length} transaksi sebagai loan-settled.`)
      } else {
        setActionMessage('Tidak ada perubahan status yang dilakukan.')
      }

      if (fail.length > 0) {
        const detail = errors
          .map(err => `${err.orderId ?? 'unknown'}: ${err.message}`)
          .join('; ')
        setActionError(`Gagal menandai ${fail.length} transaksi: ${detail}`)
      } else {
        setActionError('')
        if (ok.length > 0) {
          if (noteRef.current) {
            noteRef.current.value = ''
          }
        }
      }
    } catch (err: any) {
      setActionError(err?.response?.data?.error ?? 'Gagal menandai transaksi sebagai loan-settled')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLoadTransactions = () => {
    setActionError('')
    setActionMessage('')
    void loadTransactions()
  }

  const hiddenCount = transactions.length - displayedTransactions.length
  const displayedTotalCount = Math.max(
    displayedTransactions.length,
    rawTotalCount - hiddenCount
  )
  const hasMore = transactions.length < rawTotalCount
  const jobInProgress = rangeJobStatus === 'queued' || rangeJobStatus === 'running'
  const showJobSpinner = startingJob || jobInProgress
  const jobStatusLabel: Record<LoanSettlementJobStatus, string> = {
    queued: 'Dalam antrean',
    running: 'Sedang diproses',
    completed: 'Selesai',
    failed: 'Gagal',
  }
  const currentJobLabel =
    rangeJobStatus !== '' ? jobStatusLabel[rangeJobStatus] : ''

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">Loan Management</h1>
          <p className="text-sm text-neutral-400">
            Pantau transaksi loan dan tandai pembayaran manual sebagai loan-settled.
          </p>
        </header>

        {subsError && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            <AlertCircle size={16} /> {subsError}
          </div>
        )}

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-sm">
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-1">
                <label htmlFor="loan-sub-merchant" className="text-sm font-medium">
                  Sub-merchant
                </label>
                <select
                  id="loan-sub-merchant"
                  value={selectedSub}
                  onChange={event => setSelectedSub(event.target.value)}
                  disabled={loadingSubs}
                  className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none disabled:opacity-60"
                >
                  <option value="">Pilih sub-merchant…</option>
                  {subMerchants.map(sub => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name || sub.id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="loan-date-range" className="text-sm font-medium">
                  Rentang tanggal (WIB)
                </label>
                <DatePicker
                  id="loan-date-range"
                  selectsRange
                  startDate={startDate}
                  endDate={endDate}
                  onChange={(range: [Date | null, Date | null] | Date | null) => {
                    const [start, end] = (range as [Date | null, Date | null]) || [null, null]
                    setDateRange([start, end])
                  }}
                  withPortal
                  isClearable
                  maxDate={new Date()}
                  dateFormat="dd-MM-yyyy"
                  placeholderText="Pilih rentang tanggal"
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="loan-page-size" className="text-sm font-medium">
                  Jumlah per permintaan
                </label>
                <select
                  id="loan-page-size"
                  value={requestedPageSize}
                  onChange={event => {
                    const value = Number(event.target.value)
                    setRequestedPageSize(value)
                    setEffectivePageSize(value)
                    setTransactions([])
                    setRawTotalCount(0)
                    setLastLoadedPage(0)
                    setSelectedOrders([])
                  }}
                  disabled={loadingTx || loadingMore || submitting}
                  className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60"
                >
                  {pageSizeOptions.map(option => (
                    <option key={option} value={option}>
                      {option.toLocaleString('id-ID')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-end">
                <button
                  type="button"
                  onClick={handleLoadTransactions}
                  disabled={loadingSubs || submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-800 px-3 py-2.5 text-sm font-medium transition hover:bg-neutral-800/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingTx ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
                  Muat Transaksi
                </button>
              </div>
            </div>

            {formError && (
              <div className="inline-flex items-center gap-2 text-sm text-amber-300">
                <AlertCircle size={16} /> {formError}
              </div>
            )}

            {(actionMessage || actionError) && (
              <div className="space-y-2" aria-live="polite">
                {actionMessage && (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
                    <CheckCircle size={16} /> {actionMessage}
                  </div>
                )}
                {actionError && (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
                    <AlertCircle size={16} /> {actionError}
                  </div>
                )}
              </div>
            )}

            {txError && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
                <AlertCircle size={16} /> {txError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-300">
              <span>
                Menampilkan <strong>{displayedTransactions.length}</strong> dari{' '}
                <strong>{displayedTotalCount}</strong> transaksi
              </span>
              <span>
                Ukuran batch efektif:{' '}
                <strong>{effectivePageSize.toLocaleString('id-ID')}</strong>
              </span>
              <span>
                Pending amount: <strong>{formatCurrency(totalPending)}</strong>
              </span>
              <span>
                Loan amount: <strong>{formatCurrency(totalLoanAmount)}</strong>
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-indigo-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-200">
                <span>Dipilih</span>
                <span>{selectedSummary.count.toLocaleString('id-ID')}</span>
              </span>
              <span>
                Pending terpilih: <strong>{formatCurrency(selectedSummary.pending)}</strong>
              </span>
              <span>
                Loan terpilih: <strong>{formatCurrency(selectedSummary.loan)}</strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900/60">
                    <th className="px-3 py-2 text-left">
                      <input
                        type="checkbox"
                        aria-label={`Pilih semua transaksi ${SELECTABLE_LOAN_STATUS_LABEL}`}
                        checked={selectableIds.length > 0 && selectedOrders.length === selectableIds.length}
                        onChange={event => toggleAll(event.target.checked)}
                        disabled={selectableIds.length === 0}
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Order ID</th>
                    <th className="px-3 py-2 text-left">Dibuat</th>
                    <th className="px-3 py-2 text-left">Nominal</th>
                    <th className="px-3 py-2 text-left">Pending Amount</th>
                    <th className="px-3 py-2 text-left">Loan Amount</th>
                    <th className="px-3 py-2 text-left">Loan Created</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingTx ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-neutral-400">
                        <div className="inline-flex items-center gap-2">
                          <Loader2 className="animate-spin" size={16} /> Memuat transaksi…
                        </div>
                      </td>
                    </tr>
                  ) : displayedTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-neutral-400">
                        Tidak ada data untuk filter saat ini.
                      </td>
                    </tr>
                  ) : (
                    displayedTransactions.map(tx => {
                      const disabled = !isSelectableLoanStatus(tx.status)
                      const checked = selectedOrders.includes(tx.id)
                      return (
                        <tr key={tx.id} className="border-b border-neutral-800 last:border-0">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Pilih transaksi ${tx.id}`}
                              checked={checked}
                              onChange={event => toggleOne(tx.id, event.target.checked, disabled)}
                              disabled={disabled}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{tx.id}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(tx.createdAt)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatCurrency(tx.amount)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatCurrency(tx.pendingAmount)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {tx.loanAmount != null ? formatCurrency(tx.loanAmount) : '-'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatDateTime(tx.loanCreatedAt ?? tx.loanedAt)}
                          </td>
                          <td className="px-3 py-2">
                            <LoanStatusBadge status={tx.status} />
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => void loadMoreTransactions()}
                  disabled={loadingMore}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-800 px-3 py-2.5 text-sm font-medium transition hover:bg-neutral-800/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 className="animate-spin" size={16} /> : null}
                  Muat Lebih
                </button>
              </div>
            )}

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="text-xs text-neutral-400 sm:max-w-sm">
                Hanya transaksi berstatus{' '}
                {SELECTABLE_LOAN_STATUSES.length > 1 ? (
                  <>
                    <strong>{SELECTABLE_LOAN_STATUSES.slice(0, -1).join(', ')}</strong> atau{' '}
                    <strong>{SELECTABLE_LOAN_STATUSES.slice(-1)[0]}</strong>
                  </>
                ) : (
                  <strong>{SELECTABLE_LOAN_STATUSES[0]}</strong>
                )}{' '}
                yang dapat ditandai sebagai loan-settled.
              </div>
              <div className="flex w-full flex-col gap-3 sm:w-80">
                <label htmlFor="loan-note" className="text-sm font-medium text-neutral-200">
                  Catatan (opsional)
                </label>
                <textarea
                  id="loan-note"
                  ref={noteRef}
                  placeholder="Contoh: penyesuaian manual oleh tim loan"
                  rows={3}
                  maxLength={500}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/30"
                />
                <p className="text-xs text-neutral-500">
                  Catatan akan tersimpan dalam metadata audit untuk referensi tim finance.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={startRangeSettlement}
                    disabled={
                      showJobSpinner || loadingSubs || loadingTx || !selectedSub || !startDate || !endDate
                    }
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-900/50 bg-indigo-950/30 px-3 py-2.5 text-sm font-medium text-indigo-100 transition hover:bg-indigo-900/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {showJobSpinner ? <Loader2 className="animate-spin" size={16} /> : null}
                    Mulai Penandaan Rentang
                  </button>
                  <button
                    type="button"
                    onClick={settleSelected}
                    disabled={submitting || selectedOrders.length === 0}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-purple-900/50 bg-purple-950/30 px-3 py-2.5 text-sm font-medium text-purple-100 transition hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : null}
                    Tandai Loan Settled ({selectedOrders.length.toLocaleString('id-ID')})
                  </button>
                </div>
                {rangeJobStatus !== '' ? (
                  <div className="space-y-1 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-300">
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-neutral-400">
                      <span>Status job</span>
                      <span className="font-semibold text-neutral-100">{currentJobLabel}</span>
                    </div>
                    {rangeJobId ? (
                      <div className="text-[11px] text-neutral-500">ID: {rangeJobId}</div>
                    ) : null}
                    {rangeJobSummary ? (
                      <div className="flex flex-wrap gap-3 text-neutral-300">
                        <span>
                          Berhasil:{' '}
                          <strong>{rangeJobSummary.ok.length.toLocaleString('id-ID')}</strong>
                        </span>
                        <span>
                          Gagal:{' '}
                          <strong>{rangeJobSummary.fail.length.toLocaleString('id-ID')}</strong>
                        </span>
                      </div>
                    ) : null}
                    {rangeJobError ? (
                      <div className="text-[11px] text-rose-300">{rangeJobError}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default function LoanPage() {
  useRequireAuth()
  return <LoanPageView />
}
