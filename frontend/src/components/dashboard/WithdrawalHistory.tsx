'use client'

import { useEffect, useState } from 'react'
import DatePicker from 'react-datepicker'
import { Search, Calendar, ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import api from '@/lib/api'
import { Withdrawal } from '@/types/dashboard'
import 'react-datepicker/dist/react-datepicker.css'

export default function WithdrawalHistory(_: any) {
  // ——— state
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchRef, setSearchRef] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [startDate, endDate] = dateRange

  // ——— fetch
  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      setError('')
      try {
        const params: any = { page, limit: perPage }
        if (statusFilter) params.status = statusFilter
        if (searchRef) params.ref = searchRef
        if (startDate) params.fromDate = startDate.toISOString()
        if (endDate) params.toDate = endDate.toISOString()

        const { data } = await api.get<{ data: Withdrawal[]; total: number }>(
          '/admin/merchants/dashboard/withdrawals',
          { params }
        )
        setWithdrawals(data.data)
        setTotalPages(Math.max(1, Math.ceil((data.total || 0) / perPage)))
      } catch {
        setError('Failed to load withdrawals')
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [searchRef, statusFilter, startDate, endDate, page, perPage])

  // ——— badges
  const statusBadge = (s?: string) => {
    const v = (s || '').toUpperCase()
    const map: Record<string, string> = {
      PENDING:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40',
      COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40',
      FAILED:    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40',
    }
    const cls =
      map[v] ??
      'bg-neutral-50 text-neutral-700 border-neutral-200 dark:bg-neutral-900/60 dark:text-neutral-300 dark:border-neutral-800'
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{v || '-'}</span>
  }

  const boolBadge = (b?: boolean) => (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        b
          ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/40'
          : 'bg-neutral-50 text-neutral-700 border-neutral-200 dark:bg-neutral-900/60 dark:text-neutral-300 dark:border-neutral-800'
      }`}
    >
      {b ? 'Yes' : 'No'}
    </span>
  )

  // ——— export (current view) to CSV
  const exportCsv = () => {
    if (!withdrawals?.length) return
    const headers = [
      'Date','Ref ID','Account Name','Alias','Account No.','Bank Code','Bank Name','Branch',
      'Wallet/Submerchant','Withdrawal Fee','Amount','Net Amount','PG Fee','PG Trx ID','In Process','Status','Completed At',
    ]
    const rows = withdrawals.map((w) => [
      new Date(w.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
      w.refId ?? '', w.accountName ?? '', w.accountNameAlias ?? '', w.accountNumber ?? '',
      w.bankCode ?? '', w.bankName ?? '', w.branchName ?? '', w.wallet ?? '',
      (w.amount - (w.netAmount ?? 0)).toString(),
      w.amount.toString(),
      w.netAmount?.toString() ?? '',
      w.pgFee?.toString() ?? '',
      w.paymentGatewayId ?? '',
      w.isTransferProcess ? 'Yes' : 'No',
      w.status ?? '',
      w.completedAt ? new Date(w.completedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '',
    ])

    const csv =
      [headers, ...rows]
        .map(r => r.map(v => {
          const s = String(v ?? '')
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        }).join(','))
        .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'withdrawals.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ——— UI (paksa dark mode: wrapper pakai className="dark")
  return (
    <div className="dark">
      <div className="rounded-2xl border bg-white/80 p-4 sm:p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
        {/* Filters */}
        <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Search Ref */}
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" size={16} />
            <input
              type="text"
              placeholder="Search Ref ID…"
              value={searchRef}
              onChange={(e) => { setSearchRef(e.target.value); setPage(1) }}
              className="w-full h-10 pl-9 pr-3 rounded-xl border bg-white text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>

          {/* Status */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="w-full h-10 rounded-xl border bg-white px-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <option value="">All Status</option>
              <option value="PENDING">PENDING</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>

          {/* Date Range */}
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" size={16} />
            <DatePicker
              selectsRange
              startDate={startDate}
              endDate={endDate}
              onChange={(update: [Date | null, Date | null]) => { setDateRange(update); setPage(1) }}
              isClearable
              placeholderText="Select Date Range…"
              maxDate={new Date()}
              dateFormat="dd-MM-yyyy"
              /* ⬇️ kunci supaya tidak ketutup header/table */
              withPortal
              popperProps={{ strategy: 'fixed' }}
              popperClassName="datepicker-popper"
              calendarClassName="dp-dark"
              className="w-full h-10 pl-9 pr-3 rounded-xl border bg-white text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>

          {/* Export + Rows */}
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            {/* <button
              onClick={exportCsv}
              disabled={!withdrawals.length}
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
            >
              <FileText size={16} />
              Export CSV
            </button> */}

            <div className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm dark:border-neutral-800">
              <span>Rows</span>
              <select
                value={perPage}
                onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1) }}
                className="h-8 rounded-md border bg-white px-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {[10, 20, 50].map((n) => (<option key={n} value={n}>{n}</option>))}
              </select>
            </div>
          </div>
        </section>

        {/* Table */}
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Withdrawal History</h2>
            {!loading && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {withdrawals?.length ? `${withdrawals.length.toLocaleString('id-ID')} baris` : '—'}
              </div>
            )}
          </div>

          {error && (
            <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          {loading ? (
            <div className="grid gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
              ))}
              <div className="sr-only">Loading withdrawals…</div>
            </div>
          ) : withdrawals.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed py-14 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              No withdrawals
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1200px] w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-neutral-50/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
                    {[
                      'Date','Ref ID','Account Name','Alias','Account No.','Bank Code','Bank Name','Branch',
                      'Wallet/Submerchant','Withdrawal Fee','Amount','Net Amount','PG Fee','PG Trx ID','In Process','Status','Completed At',
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-300">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((w) => (
                    <tr
                      key={w.id}
                      className="border-b last:border-0 hover:bg-neutral-50/60 dark:border-neutral-800 dark:hover:bg-neutral-900/60"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(w.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-3 py-2">{w.refId}</td>
                      <td className="px-3 py-2">{w.accountName}</td>
                      <td className="px-3 py-2">{w.accountNameAlias}</td>
                      <td className="px-3 py-2">{w.accountNumber}</td>
                      <td className="px-3 py-2">{w.bankCode}</td>
                      <td className="px-3 py-2">{w.bankName}</td>
                      <td className="px-3 py-2">{w.branchName ?? '-'}</td>
                      <td className="px-3 py-2">{w.wallet}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {(w.amount - (w.netAmount ?? 0)).toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {w.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {w.netAmount != null ? w.netAmount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' }) : '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {w.pgFee != null ? w.pgFee.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' }) : '-'}
                      </td>
                      <td className="px-3 py-2">{w.paymentGatewayId ?? '-'}</td>
                      <td className="px-3 py-2">{boolBadge(w.isTransferProcess)}</td>
                      <td className="px-3 py-2">{statusBadge(w.status)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {w.completedAt
                          ? new Date(w.completedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Page <b>{page}</b> of <b>{totalPages}</b>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 disabled:opacity-50 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
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
                className="inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 disabled:opacity-50 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ⬇️ Global style: z-index popper & tema dark datepicker */}
      <style jsx global>{`
        .datepicker-popper.react-datepicker-popper { z-index: 2147483647 !important; }
        .dp-dark.react-datepicker {
          background-color: #0a0a0a; border: 1px solid #262626; color: #e5e5e5;
        }
        .dp-dark .react-datepicker__header {
          background-color: #111111; border-bottom: 1px solid #262626;
        }
        .dp-dark .react-datepicker__current-month,
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
