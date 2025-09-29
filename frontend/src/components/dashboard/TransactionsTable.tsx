'use client'

import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react'
import {
  FileText,
  ClipboardCopy,
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import api from '@/lib/api'
import { Tx } from '@/types/dashboard'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

interface TransactionsTableProps {
  search: string
  setSearch: Dispatch<SetStateAction<string>>
  statusFilter: string
  setStatusFilter: Dispatch<SetStateAction<string>>
  loadingTx: boolean
  txs: Tx[]
  perPage: number
  setPerPage: Dispatch<SetStateAction<number>>
  page: number
  setPage: Dispatch<SetStateAction<number>>
  totalPages: number
  buildParams: () => any
  onDateChange: (dates: [Date | null, Date | null]) => void
  onSelectIds?: (ids: string[]) => void
}

export default function TransactionsTable({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  loadingTx,
  txs,
  perPage,
  setPerPage,
  page,
  setPage,
  totalPages,
  buildParams,
  onDateChange,
  onSelectIds,
}: TransactionsTableProps) {
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const hasData = txs && txs.length > 0

  // Ensure a portal root for the datepicker so the popper isn't clipped
  useEffect(() => {
    if (typeof window === 'undefined') return
    let portal = document.getElementById('root-portal')
    if (!portal) {
      portal = document.createElement('div')
      portal.id = 'root-portal'
      document.body.appendChild(portal)
    }
  }, [])

  const exportAll = async () => {
    try {
      const r = await api.get('/admin/merchants/dashboard/export-all', {
        params: buildParams(),
        responseType: 'blob',
      })
      const blob = new Blob([r.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dashboard-all-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Gagal export data')
    }
  }

  const statusBadge = (s?: string) => {
    const v = (s || '').toUpperCase()
    const map: Record<string, { className: string; label?: string; title?: string }> = {
      SUCCESS: { className: 'bg-emerald-950/40 text-emerald-300 border-emerald-900/40' },
      PAID: { className: 'bg-indigo-950/40 text-indigo-300 border-indigo-900/40' },
      PENDING: { className: 'bg-amber-950/40 text-amber-300 border-amber-900/40' },
      EXPIRED: { className: 'bg-neutral-900/60 text-neutral-300 border-neutral-800' },
      DONE: { className: 'bg-sky-950/40 text-sky-300 border-sky-900/40' },
      FAILED: { className: 'bg-rose-950/40 text-rose-300 border-rose-900/40' },
      LN_SETTLED: {
        className: 'bg-purple-950/40 text-purple-200 border-purple-900/40',
        label: 'LOAN SETTLED',
        title:
          'Loan-settled: transaksi ditandai sebagai pelunasan pinjaman/manual, tidak ikut proses settlement.',
      },
    }
    const meta = map[v] ?? map.EXPIRED
    return (
      <span
        title={meta.title}
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}
      >
        {meta.label ?? (v || '-')}
      </span>
    )
  }

  const settlementBadge = (raw?: string) => {
    const norm = raw === 'WAITING' ? 'PENDING' : raw === 'UNSUCCESSFUL' ? 'FAILED' : raw || '-'
    return statusBadge(norm)
  }

  const columns = useMemo(
    () => [
      { key: 'select', label: '', className: 'min-w-[40px]' },
      { key: 'date', label: 'Date', className: 'min-w-[160px]' },
      { key: 'paymentReceivedTime', label: 'Update At', className: 'min-w-[160px]' },
      { key: 'settlementTime', label: 'Settled At', className: 'min-w-[160px]' },
      { key: 'id', label: 'TRX ID', className: 'min-w-[220px]' },
      { key: 'rrn', label: 'RRN', className: 'min-w-[160px]' },
      { key: 'playerId', label: 'Player ID', className: 'min-w-[140px]' },
      { key: 'channel', label: 'PG', className: 'min-w-[120px]' },
      { key: 'amount', label: 'Amount', className: 'min-w-[140px] text-right' },
      { key: 'feeLauncx', label: 'Fee Launcx', className: 'min-w-[140px] text-right' },
      { key: 'feePg', label: 'Fee PG', className: 'min-w-[140px] text-right' },
      { key: 'netSettle', label: 'Net Amount', className: 'min-w-[160px] text-right' },
      { key: 'status', label: 'Status', className: 'min-w-[120px]' },
      { key: 'settlementStatus', label: 'Settlement Status', className: 'min-w-[160px]' },
    ],
    []
  )

  useEffect(() => {
    onSelectIds?.(selectedIds)
  }, [selectedIds, onSelectIds])

  useEffect(() => {
    setSelectedIds([])
  }, [txs])

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(txs.map(t => t.id))
    } else {
      setSelectedIds([])
    }
  }

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds(prev =>
      checked ? [...prev, id] : prev.filter(sid => sid !== id)
    )
  }

  return (
    // force dark mode for this page
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-sm p-4 sm:p-5">
        {/* Filters */}
        <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
              aria-label="Cari TRX ID, RRN, atau Player ID"
              placeholder="Cari TRX ID, RRN, atau Player ID…"
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-neutral-800 bg-neutral-900 text-sm text-neutral-100 placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
            />
          </div>

          {/* Status */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setPage(1)
                setStatusFilter(e.target.value)
              }}
              aria-label="Filter status transaksi"
              className="w-full h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
            >
              <option value="all">ALL</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="PAID">PAID</option>
              <option value="PENDING">PENDING</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="LN_SETTLED">LN_SETTLED</option>
            </select>
          </div>

          {/* Date range */}
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" size={16} />
            <DatePicker
              selectsRange
              startDate={dateRange[0]}
              endDate={dateRange[1]}
              onChange={(upd: [Date | null, Date | null] | Date | null) => {
                const range = (upd as [Date | null, Date | null]) || [null, null]
                setDateRange(range)
                onDateChange(range)
                setPage(1)
              }}
              isClearable
              placeholderText="Filter tanggal…"
              maxDate={new Date()}
              dateFormat="dd-MM-yyyy"
              /* ⬇️ ini kunci anti-kehalang */
              withPortal
              popperProps={{ strategy: 'fixed' }}
              popperClassName="datepicker-popper"
              calendarClassName="dp-dark"
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-neutral-800 bg-neutral-900 text-sm text-neutral-100 placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
            />
          </div>

          {/* Export */}
          <div className="flex sm:justify-end">
            <button
              onClick={exportAll}
              className="inline-flex w-full sm:w-auto items-center gap-2 rounded-xl border border-neutral-800 px-3 py-2.5 text-sm font-medium shadow-sm transition hover:bg-neutral-800/60"
            >
              <FileText size={16} />
              Export Semua
            </button>
          </div>
        </section>

        {/* Table Section */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Daftar Transaksi &amp; Settlement</h2>
            {!loadingTx && (
              <div className="text-xs text-neutral-400">
                {hasData ? `${txs.length.toLocaleString('id-ID')} baris` : '—'}
              </div>
            )}
          </div>

          {loadingTx ? (
            <div className="grid gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-neutral-800" />
              ))}
              <div className="sr-only">Loading transaksi…</div>
            </div>
          ) : !hasData ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-neutral-800 py-14 text-sm text-neutral-400">
              Tidak ada data untuk filter saat ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1200px] w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className={`px-3 py-2 text-left font-medium text-neutral-300 ${c.className || ''}`}
                      >
                        {c.key === 'select' ? (
                          <input
                            type="checkbox"
                            aria-label="Select all"
                            checked={selectedIds.length === txs.length && txs.length > 0}
                            onChange={(e) => toggleAll(e.target.checked)}
                          />
                        ) : (
                          c.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select transaction ${t.id}`}
                          checked={selectedIds.includes(t.id)}
                          onChange={(e) => toggleOne(t.id, e.target.checked)}
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(t.date).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {t.paymentReceivedTime
                          ? new Date(t.paymentReceivedTime).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
                          : '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {t.settlementTime
                          ? new Date(t.settlementTime).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
                          : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[12px]">{t.id}</code>
                          <button
                            title="Copy TRX ID"
                            onClick={() => navigator.clipboard.writeText(t.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60"
                          >
                            <ClipboardCopy size={14} />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="max-w-[220px] truncate">{t.rrn}</span>
                          <button
                            title="Copy RRN"
                            onClick={() => navigator.clipboard.writeText(t.rrn)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60"
                          >
                            <ClipboardCopy size={14} />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">{t.playerId}</td>
                      <td className="px-3 py-2">{t.channel}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {t.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {t.feeLauncx.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {t.feePg.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                        <div className="flex flex-col items-end gap-0.5">
                          <span>
                            {t.netSettle.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                          </span>
                          {t.status === 'LN_SETTLED' && (
                            <span className="text-[11px] font-normal uppercase tracking-wide text-purple-200/80">
                              Loan Amount
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">{statusBadge(t.status)}</td>
                      <td className="px-3 py-2">{settlementBadge(t.settlementStatus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="flex items-center gap-2 text-sm">
              <span>Rows</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value))
                  setPage(1)
                }}
                aria-label="Rows per page"
                className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-sm text-neutral-100"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
              >
                <ChevronLeft size={16} />
                Prev
              </button>
              <span className="min-w-[70px] text-center">
                {page}/{totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </section>
      </div>

<style jsx global>{`
  /* make sure the portal exists in <body> */
  #root-portal { position: relative; z-index: 0; }

  /* put the datepicker popper above sticky headers, drawers, etc. */
  .datepicker-popper.react-datepicker-popper {
    z-index: 2147483647 !important;
  }

  /* dark theme for the calendar */
  .dp-dark.react-datepicker {
    background-color: #0a0a0a;
    border: 1px solid #262626;
    color: #e5e5e5;
  }
  .dp-dark .react-datepicker__header {
    background-color: #111111;
    border-bottom: 1px solid #262626;
  }
  .dp-dark .react-datepicker__current-month,
  .dp-dark .react-datepicker-time__header,
  .dp-dark .react-datepicker-year-header,
  .dp-dark .react-datepicker__day-name {
    color: #d4d4d4;
  }
  .dp-dark .react-datepicker__day { color: #e5e5e5; }
  .dp-dark .react-datepicker__day--keyboard-selected,
  .dp-dark .react-datepicker__day--selected,
  .dp-dark .react-datepicker__day--in-range {
    background-color: #4f46e5;
    color: #fff;
  }
  .dp-dark .react-datepicker__day--outside-month { color: #737373; }
`}</style>

    </div>
  )
}
