'use client'

import React, { useEffect, useMemo, useState } from 'react'
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

type LoanTransaction = {
  id: string
  amount: number
  pendingAmount: number
  status: 'PAID' | 'LN_SETTLE'
  createdAt: string
  loanedAt: string | null
  loanAmount: number | null
  loanCreatedAt: string | null
}

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
  const meta =
    status === 'LN_SETTLE'
      ? {
          label: 'Loan Settled',
          className:
            'bg-purple-950/40 text-purple-200 border border-purple-900/40',
        }
      : {
          label: 'Paid',
          className: 'bg-indigo-950/40 text-indigo-300 border border-indigo-900/40',
        }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase ${meta.className}`}>
      {meta.label}
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
  const [txError, setTxError] = useState('')
  const [formError, setFormError] = useState('')

  const [selectedOrders, setSelectedOrders] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')

  const [startDate, endDate] = dateRange

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

  useEffect(() => {
    setSelectedOrders(prev =>
      prev.filter(id => transactions.some(tx => tx.id === id && tx.status === 'PAID'))
    )
  }, [transactions])

  const selectableIds = useMemo(
    () => transactions.filter(tx => tx.status === 'PAID').map(tx => tx.id),
    [transactions]
  )

  const totalPending = useMemo(
    () => transactions.reduce((sum, tx) => sum + (tx.pendingAmount ?? 0), 0),
    [transactions]
  )
  const totalLoanAmount = useMemo(
    () => transactions.reduce((sum, tx) => sum + (tx.loanAmount ?? 0), 0),
    [transactions]
  )
  const selectedSummary = useMemo(() => {
    return transactions.reduce(
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
  }, [selectedOrders, transactions])

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

    setLoadingTx(true)
    try {
      const params = {
        subMerchantId: selectedSub,
        startDate: toWibIso(startDate),
        endDate: toWibIso(endDate),
      }
      const { data } = await apiClient.get<{ data: any[] }>('/admin/loan/transactions', {
        params,
      })

      const mapped: LoanTransaction[] = (data.data || []).map((raw) => ({
        id: raw.id,
        amount: raw.amount ?? 0,
        pendingAmount: raw.pendingAmount ?? 0,
        status: raw.status === 'LN_SETTLE' ? 'LN_SETTLE' : 'PAID',
        createdAt: raw.createdAt,
        loanedAt: raw.loanedAt ?? null,
        loanAmount: raw.loanAmount ?? null,
        loanCreatedAt: raw.loanCreatedAt ?? null,
      }))

      setTransactions(mapped)
      setSelectedOrders([])
    } catch (err: any) {
      setTxError(err?.response?.data?.error ?? 'Gagal memuat transaksi loan')
    } finally {
      setLoadingTx(false)
    }
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

  const settleSelected = async () => {
    setFormError('')
    setActionError('')

    if (!selectedSub) {
      setFormError('Pilih sub-merchant terlebih dahulu.')
      return
    }
    if (selectedOrders.length === 0) {
      setFormError('Pilih minimal satu transaksi berstatus PAID.')
      return
    }

    setSubmitting(true)
    try {
      const settledCount = selectedOrders.length
      await apiClient.post('/admin/loan/settle', {
        subMerchantId: selectedSub,
        orderIds: selectedOrders,
      })
      await loadTransactions()
      setActionMessage(`Berhasil mengirim permintaan settle untuk ${settledCount} transaksi`)
    } catch (err: any) {
      setActionError(err?.response?.data?.error ?? 'Gagal mengirim permintaan settle')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLoadTransactions = () => {
    setActionError('')
    setActionMessage('')
    void loadTransactions()
  }

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">Loan Management</h1>
          <p className="text-sm text-neutral-400">
            Pantau dan settle transaksi loan untuk sub-merchant terpilih.
          </p>
        </header>

        {subsError && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            <AlertCircle size={16} /> {subsError}
          </div>
        )}

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-sm">
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]">
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
                Total data: <strong>{transactions.length}</strong>
              </span>
              <span>
                Pending amount: <strong>{formatCurrency(totalPending)}</strong>
              </span>
              <span>
                Loan amount: <strong>{formatCurrency(totalLoanAmount)}</strong>
              </span>
              <span>
                Dipilih: <strong>{selectedSummary.count}</strong>
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
                        aria-label="Pilih semua transaksi PAID"
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
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-neutral-400">
                        Tidak ada data untuk filter saat ini.
                      </td>
                    </tr>
                  ) : (
                    transactions.map(tx => {
                      const disabled = tx.status !== 'PAID'
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-neutral-400">
                Hanya transaksi berstatus <strong>PAID</strong> yang dapat disettle menjadi loan.
              </div>
              <button
                type="button"
                onClick={settleSelected}
                disabled={submitting || selectedOrders.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-purple-900/50 bg-purple-950/30 px-3 py-2.5 text-sm font-medium text-purple-100 transition hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="animate-spin" size={16} /> : null}
                Settle Loan
              </button>
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
