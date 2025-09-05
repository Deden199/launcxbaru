'use client'

import { useState, useEffect } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import TransactionsTable from '@/components/dashboard/TransactionsTable'
import { Tx } from '@/types/dashboard'
import { AlertCircle, CheckCircle } from 'lucide-react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { hourRange } from '@/utils/timeRange'

dayjs.extend(utc)
dayjs.extend(timezone)

export default function SettlementAdjustPage() {
  useRequireAuth()

  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)

  const [txs, setTxs] = useState<Tx[]>([])
  const [loadingTx, setLoadingTx] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const [newStatus, setNewStatus] = useState('SETTLED')
  const [settlementTime, setSettlementTime] = useState<Date | null>(null)
  const [fee, setFee] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [mode, setMode] = useState<'FULL_DAY' | 'TRANSACTION_ID' | 'PER_HOUR'>('FULL_DAY')
  const [adjustDate, setAdjustDate] = useState<Date | null>(null)
  const [transactionIds, setTransactionIds] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const buildParams = () => {
    const p: any = { page, limit: perPage }
    if (startDate) p.date_from = dayjs(startDate).tz('Asia/Jakarta', true).toDate().toISOString()
    if (endDate) p.date_to = dayjs(endDate).tz('Asia/Jakarta', true).toDate().toISOString()
    if (statusFilter !== 'all') p.status = statusFilter
    if (search.trim()) p.search = search.trim()
    return p
  }

  const mapTx = (o: any): Tx => ({
    id: o.id,
    date: o.date || o.createdAt || '',
    rrn: o.rrn || '-',
    playerId: o.playerId || '',
    amount: o.amount || 0,
    feeLauncx: o.feeLauncx || 0,
    feePg: o.feePg || o.fee3rdParty || 0,
    netSettle: o.netSettle ?? o.settlementAmount ?? 0,
    status: o.status || '',
    settlementStatus: o.settlementStatus || '',
    channel: o.channel || '',
    paymentReceivedTime: o.paymentReceivedTime || '',
    settlementTime: o.settlementTime || '',
    trxExpirationTime: o.trxExpirationTime || '',
  })

  const handleDateChange = (dates: [Date | null, Date | null]) => {
    setStartDate(dates[0])
    setEndDate(dates[1])
    fetchTransactions()
  }

  async function fetchTransactions() {
    setError('')
    setLoadingTx(true)
    try {
      const params = buildParams()
      const { data } = await api.get('/admin/merchants/dashboard/transactions', { params })
      const mapped = (data.transactions || []).map(mapTx)
      setTotalPages(Math.max(1, Math.ceil((data.total || mapped.length) / perPage)))
      setTxs(mapped)
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to fetch transactions')
    } finally {
      setLoadingTx(false)
    }
  }

  useEffect(() => {
    fetchTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, page, perPage])

  useEffect(() => {
    if (mode === 'TRANSACTION_ID') {
      setTransactionIds(selectedIds.join(','))
    }
  }, [mode, selectedIds])

  const submit = async () => {
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const payload: any = { settlementStatus: newStatus }
      if (mode === 'FULL_DAY') {
        if (!adjustDate) throw new Error('Date is required')
        const start = dayjs(adjustDate).tz('Asia/Jakarta', true).startOf('day')
        if (!start.isValid()) throw new Error('Invalid date')
        const end = start.add(1, 'day')
        payload.dateFrom = start.toDate().toISOString()
        payload.dateTo = end.toDate().toISOString()
      } else if (mode === 'PER_HOUR') {
        if (!adjustDate) throw new Error('Date and hour are required')
        // Derive hourly range in Jakarta time for the selected adjustment
        const { from, to } = hourRange(adjustDate, adjustDate.getHours())
        payload.dateFrom = from
        payload.dateTo = to
      } else if (mode === 'TRANSACTION_ID') {
        const ids = transactionIds
          .split(',')
          .map(id => id.trim())
          .filter(Boolean)
        if (!ids.length) throw new Error('Transaction IDs are required')
        payload.transactionIds = ids
      }
      if (settlementTime) {
        const st = dayjs(settlementTime).tz('Asia/Jakarta', true)
        if (!st.isValid()) throw new Error('Invalid settlement time')
        payload.settlementTime = st.toDate().toISOString()
      }
      if (fee) payload.feeLauncx = Number(fee)
      const { data } = await api.post('/admin/settlement/adjust', payload)
      setMessage(`Updated ${data.data.updated} transactions`)
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Failed to adjust settlements')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="mb-4">
          <h1 className="text-xl font-semibold">Settlement Adjustment</h1>
          <p className="text-xs text-neutral-400">Update settlement status and fee for selected transactions</p>
        </header>

        {(message || error) && (
          <div className="space-y-2">
            {message && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
                <CheckCircle size={16} /> {message}
              </div>
            )}
            {error && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                <AlertCircle size={16} /> {error}
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-sm">
          <TransactionsTable
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            loadingTx={loadingTx}
            txs={txs}
            perPage={perPage}
            setPerPage={setPerPage}
            page={page}
            setPage={setPage}
            totalPages={totalPages}
            buildParams={buildParams}
            onDateChange={handleDateChange}
            onSelectIds={setSelectedIds}
          />
        </div>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <select
              value={mode}
              onChange={e => setMode(e.target.value as any)}
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
            >
              <option value="FULL_DAY">FULL_DAY</option>
              <option value="PER_HOUR">PER_HOUR</option>
              <option value="TRANSACTION_ID">TRANSACTION_ID</option>
            </select>
            {mode === 'FULL_DAY' && (
              <DatePicker
                selected={adjustDate}
                onChange={(date: Date | null) => setAdjustDate(date)}
                dateFormat="dd-MM-yyyy"
                withPortal
                popperProps={{ strategy: 'fixed' }}
                popperClassName="datepicker-popper"
                calendarClassName="dp-dark"
                className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
              />
            )}
            {mode === 'PER_HOUR' && (
              <DatePicker
                selected={adjustDate}
                onChange={(date: Date | null) => setAdjustDate(date)}
                showTimeSelect
                timeIntervals={60}
                dateFormat="dd-MM-yyyy HH:00"
                withPortal
                popperProps={{ strategy: 'fixed' }}
                popperClassName="datepicker-popper"
                calendarClassName="dp-dark"
                className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
              />
            )}
            {mode === 'TRANSACTION_ID' && (
              <textarea
                placeholder="Comma-separated IDs"
                value={transactionIds}
                onChange={e => setTransactionIds(e.target.value)}
                className="h-24 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
              />
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <select
              value={newStatus}
              onChange={e => setNewStatus(e.target.value)}
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
            >
              <option value="SETTLED">SETTLED</option>
              <option value="WAITING">WAITING</option>
              <option value="UNSUCCESSFUL">UNSUCCESSFUL</option>
            </select>
            <DatePicker
              selected={settlementTime}
              onChange={(date: Date | null) => setSettlementTime(date)}
              showTimeSelect
              dateFormat="dd-MM-yyyy HH:mm"
              withPortal
              popperProps={{ strategy: 'fixed' }}
              popperClassName="datepicker-popper"
              calendarClassName="dp-dark"
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
            />
            <input
              type="number"
              placeholder="Launcx Fee"
              value={fee}
              onChange={e => setFee(e.target.value)}
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none"
            />
          </div>
          <button
            onClick={submit}
            disabled={submitting}
            className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Adjustment'}
          </button>
        </section>
      </div>
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

