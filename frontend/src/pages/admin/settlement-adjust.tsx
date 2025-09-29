'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

dayjs.extend(utc)
dayjs.extend(timezone)

const WIB = 'Asia/Jakarta'

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
  netAmount: number
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

const DATEPICKER_POPPER = {
  strategy: 'fixed' as const,
}

function formatCurrency(value: number) {
  return value.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })
}

function toWibStart(date: Date) {
  return dayjs(date).tz(WIB, true).startOf('day')
}

function toWibEnd(date: Date) {
  return dayjs(date).tz(WIB, true).endOf('day')
}

export default function SettlementAdjustPage() {
  useRequireAuth()

  const [isAdmin, setIsAdmin] = useState(false)

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
    end.setDate(end.getDate() - 7)
    const start = new Date()
    start.setDate(start.getDate() - 30)
    return [start, end]
  }, [])

  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>(defaultRange)
  const [selectedSubMerchant, setSelectedSubMerchant] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [subMerchants, setSubMerchants] = useState<SubMerchantOption[]>([])
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [subsError, setSubsError] = useState('')

  const [rows, setRows] = useState<SettlementRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [rowsError, setRowsError] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [totalCount, setTotalCount] = useState(0)

  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const [showConfirm, setShowConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [toast, setToast] = useState<ToastState>(null)
  const [errorList, setErrorList] = useState<{ id?: string; message?: string }[]>([])

  const [datePickerRange, setDatePickerRange] = useState<[Date | null, Date | null]>(defaultRange)

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

  const fetchRows = useCallback(
    async (targetPage: number) => {
      const [start, end] = dateRange
      if (!start || !end) return

      setRowsError('')
      setLoadingRows(true)

      const params: Record<string, any> = {
        status: 'SETTLED',
        hasSettlementTime: true,
        page: targetPage,
        limit: pageSize,
      }
      if (selectedSubMerchant !== 'all') params.subMerchantId = selectedSubMerchant
      if (debouncedSearch) params.q = debouncedSearch
      params.from = toWibStart(start).toISOString()
      params.to = toWibEnd(end).toISOString()

      try {
        const { data } = await api.get<any>('/admin/orders', { params })
        const listSource = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.orders)
          ? data.orders
          : Array.isArray(data?.transactions)
          ? data.transactions
          : []
        const mapped: SettlementRow[] = listSource
          .map((raw: any) => ({
            id: raw.id ?? raw.orderId ?? raw.transactionId ?? '',
            subMerchantId:
              raw.subMerchantId ?? raw.sub_merchant_id ?? raw.subMerchant?.id ?? raw.partnerClientId ?? '',
            subMerchantName:
              raw.subMerchantName ?? raw.subMerchant?.name ?? raw.sub_merchant_name ?? raw.partnerName ?? null,
            status: (raw.status ?? '').toString(),
            settlementTime:
              raw.settlementTime ?? raw.settlement_time ?? raw.settledAt ?? raw.settlement_at ?? null,
            settlementAmount:
              raw.settlementAmount ?? raw.settlement_amount ?? raw.netSettle ?? raw.net_settle ?? null,
            netAmount:
              Number(
                raw.netAmount ??
                  raw.net_amount ??
                  raw.netSettle ??
                  raw.net_settle ??
                  raw.settlementAmount ??
                  raw.amount ??
                  0
              ) || 0,
          }))
          .filter((row: SettlementRow) => Boolean(row.id) && Boolean(row.settlementTime))

        setRows(mapped)
        setTotalCount(
          data?.meta?.total ?? data?.total ?? (Array.isArray(listSource) ? listSource.length : mapped.length)
        )
        setPage(targetPage)
      } catch (err: any) {
        if (err?.response?.status === 404) {
          setRowsError('Endpoint data settlement belum tersedia.')
        } else {
          setRowsError(err?.response?.data?.error ?? 'Gagal memuat data settlement')
        }
        setRows([])
        setTotalCount(0)
      } finally {
        setLoadingRows(false)
      }
    },
    [dateRange, debouncedSearch, pageSize, selectedSubMerchant]
  )

  useEffect(() => {
    const [start, end] = dateRange
    if (!start || !end) return
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
          acc.total += row.settlementAmount ?? row.netAmount ?? 0
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
    setDateRange(defaultRange)
    setDatePickerRange(defaultRange)
  }

  const onConfirmReverse = async () => {
    if (!selectedIds.length) return
    setSubmitting(true)
    setToast(null)
    setErrorList([])
    try {
      const payload: { orderIds: string[]; subMerchantId?: string; reason?: string } = {
        orderIds: selectedIds,
      }
      if (selectedSubMerchant !== 'all') payload.subMerchantId = selectedSubMerchant
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

  const canReverse = isAdmin && selectionSummary.count > 0

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
                <option value="all">Semua sub-merchant</option>
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
              <label className="text-xs uppercase tracking-wide text-neutral-400">Range settlement time</label>
              <DatePicker
                selectsRange
                startDate={datePickerRange[0]}
                endDate={datePickerRange[1]}
                onChange={onChangeRange}
                maxDate={new Date()}
                dateFormat="dd MMM yyyy"
                withPortal
                popperProps={DATEPICKER_POPPER}
                popperClassName="datepicker-popper"
                calendarClassName="dp-dark"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40"
              />
              <button
                onClick={onResetRange}
                className="self-start text-[11px] text-neutral-400 underline hover:text-neutral-200"
              >
                Reset ke 7–30 hari terakhir
              </button>
            </div>

            <div className="flex flex-col gap-1 md:col-span-2">
              <label className="text-xs uppercase tracking-wide text-neutral-400">Cari Order ID</label>
              <input
                type="text"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder="Masukkan Order ID / kata kunci"
                className="h-11 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40"
              />
              <span className="text-[11px] text-neutral-500">Pencarian otomatis setelah berhenti mengetik.</span>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-neutral-400">
              {loadingRows
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
            <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
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
                      disabled={!rows.length || !isAdmin}
                    />
                  </th>
                  <th className="whitespace-nowrap px-3 py-2">Order ID</th>
                  <th className="whitespace-nowrap px-3 py-2">Sub-Merchant</th>
                  <th className="whitespace-nowrap px-3 py-2">Status</th>
                  <th className="whitespace-nowrap px-3 py-2">Settlement Time</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Settlement Amount</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Net Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {loadingRows && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-neutral-400">
                      <span className="inline-flex items-center gap-2 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Memuat data settlement…
                      </span>
                    </td>
                  </tr>
                )}
                {!loadingRows && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-neutral-500">
                      Tidak ada transaksi dengan settlement time pada rentang ini.
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
                          {formatCurrency(row.settlementAmount ?? row.netAmount ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-right text-sm text-neutral-400">
                          {formatCurrency(row.netAmount ?? 0)}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-neutral-500">
            <div>
              Halaman {page} dari {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchRows(Math.max(1, page - 1))}
                disabled={page <= 1 || loadingRows}
                className="rounded-lg border border-neutral-800 px-3 py-1 text-neutral-300 transition hover:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sebelumnya
              </button>
              <button
                onClick={() => fetchRows(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages || loadingRows}
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
        .datepicker-popper.react-datepicker-popper { z-index: 2147483647 !important; }
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
