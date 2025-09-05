'use client'

import { useState, useEffect } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import TransactionsTable from '@/components/dashboard/TransactionsTable'
import { Tx } from '@/types/dashboard'
import { AlertCircle, CheckCircle } from 'lucide-react'

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
  const [settlementTime, setSettlementTime] = useState('')
  const [fee, setFee] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const buildParams = () => {
    const p: any = { page, limit: perPage }
    if (startDate) p.date_from = startDate.toISOString()
    if (endDate) p.date_to = endDate.toISOString()
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

  const submit = async () => {
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const payload: any = { settlementStatus: newStatus }
      if (startDate) payload.dateFrom = startDate.toISOString()
      if (endDate) payload.dateTo = endDate.toISOString()
      if (settlementTime) payload.settlementTime = new Date(settlementTime).toISOString()
      if (fee) payload.feeLauncx = Number(fee)
      const { data } = await api.post('/admin/settlement/adjust', payload)
      setMessage(`Updated ${data.data.updated} transactions`)
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to adjust settlements')
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
          />
        </div>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm space-y-3">
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
            <input
              type="datetime-local"
              value={settlementTime}
              onChange={e => setSettlementTime(e.target.value)}
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
    </div>
  )
}

