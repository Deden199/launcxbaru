'use client'

import { NextPage } from 'next'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import ClientLayout from '@/components/layouts/ClientLayout'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { FileText, ArrowUpDown, CheckCircle2, AlertTriangle } from 'lucide-react'
import * as XLSX from 'xlsx'

const statusBadgeClasses: Record<string, string> = {
  PENDING: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  COMPLETED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  FAILED: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

interface Withdrawal {
  id?: string
  refId: string
  bankName: string
  accountNumber: string
  accountName: string
  wallet: string
  amount: number
  netAmount: number
  withdrawFeePercent: number
  withdrawFeeFlat: number
  status: string
  createdAt: string
  completedAt?: string | null
  sourceProvider?: string
}

interface SubWallet {
  id: string
  name: string
  provider: string
  balance: number
}

const AdminClientWithdrawPage: NextPage & { disableLayout?: boolean } = () => {
  const router = useRouter()
  const { clientId } = router.query as { clientId?: string }

  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  const [wallets, setWallets] = useState<SubWallet[]>([])

  const [searchRef, setSearchRef] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [startDate, endDate] = dateRange
  const [totalPages, setTotalPages] = useState(1)

  const [manualForm, setManualForm] = useState({
    subMerchantId: '',
    amount: '',
    accountName: '',
    accountNameAlias: '',
    accountNumber: '',
    bankCode: '',
    bankName: '',
    branchName: '',
    withdrawFeePercent: '',
    withdrawFeeFlat: '',
    pgFee: '',
  })
  const [manualSubmitting, setManualSubmitting] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const loadWithdrawals = useCallback(
    async (override?: { page?: number; limit?: number }) => {
      if (!clientId) return
      setLoading(true)
      setPageError('')
      const currentPage = override?.page ?? page
      const currentLimit = override?.limit ?? perPage
      const params: Record<string, any> = { page: currentPage, limit: currentLimit, search: searchRef }
      if (statusFilter) params.status = statusFilter
      if (startDate) params.fromDate = startDate.toISOString()
      if (endDate) params.toDate = endDate.toISOString()

      try {
        const res = await api.get<{ data: Withdrawal[]; total: number }>(
          `/admin/clients/${clientId}/withdrawals`,
          { params }
        )
        setWithdrawals(res.data.data)
        setTotalPages(Math.max(1, Math.ceil(res.data.total / currentLimit)))
      } catch {
        setPageError('Failed to load data')
      } finally {
        setLoading(false)
      }
    },
    [clientId, page, perPage, searchRef, statusFilter, startDate, endDate]
  )

  useEffect(() => {
    loadWithdrawals()
  }, [loadWithdrawals])

  useEffect(() => {
    if (!clientId) return
    api
      .get<SubWallet[]>(`/admin/clients/${clientId}/subwallets`)
      .then(res => {
        setWallets(res.data)
        if (res.data.length) {
          setManualForm(prev => (prev.subMerchantId ? prev : { ...prev, subMerchantId: res.data[0].id }))
        }
      })
      .catch(() => {})
  }, [clientId])

  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timeout)
  }, [toast])

  const manualNetAmount = useMemo(() => {
    const amountVal = Number(manualForm.amount || 0)
    const percent = Number(manualForm.withdrawFeePercent || 0)
    const flat = Number(manualForm.withdrawFeeFlat || 0)
    const pg = Number(manualForm.pgFee || 0)
    if ([amountVal, percent, flat, pg].some(v => Number.isNaN(v))) return 0
    const net = amountVal - (amountVal * percent) / 100 - flat - pg
    return net > 0 ? net : 0
  }, [manualForm.amount, manualForm.withdrawFeePercent, manualForm.withdrawFeeFlat, manualForm.pgFee])

  const handleManualSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (!clientId) return

      const amountValue = Number(manualForm.amount)
      if (Number.isNaN(amountValue) || amountValue < 0) {
        setToast({ type: 'error', message: 'Amount must be greater than or equal to 0.' })
        return
      }
      if (!manualForm.subMerchantId) {
        setToast({ type: 'error', message: 'Please choose a sub-wallet.' })
        return
      }

      const accountName = manualForm.accountName.trim()
      const accountNumber = manualForm.accountNumber.trim()
      const bankCode = manualForm.bankCode.trim()
      const bankName = manualForm.bankName.trim()
      if (!accountName || !accountNumber || !bankCode || !bankName) {
        setToast({ type: 'error', message: 'Account name, number, bank code, and bank name are required.' })
        return
      }

      const payload: Record<string, any> = {
        subMerchantId: manualForm.subMerchantId,
        amount: amountValue,
        accountName,
        accountNumber,
        bankCode,
        bankName,
        accountNameAlias: manualForm.accountNameAlias.trim() || accountName,
      }

      const branch = manualForm.branchName.trim()
      if (branch) payload.branchName = branch

      const pct = manualForm.withdrawFeePercent.trim()
      const flat = manualForm.withdrawFeeFlat.trim()
      const pgFee = manualForm.pgFee.trim()
      if (pct) payload.withdrawFeePercent = Number(pct)
      if (flat) payload.withdrawFeeFlat = Number(flat)
      if (pgFee) payload.pgFee = Number(pgFee)

      for (const field of ['withdrawFeePercent', 'withdrawFeeFlat', 'pgFee'] as const) {
        if (payload[field] != null && Number.isNaN(Number(payload[field]))) {
          setToast({ type: 'error', message: 'Fee values must be numeric.' })
          return
        }
      }

      setManualSubmitting(true)
      try {
        await api.post(`/admin/clients/${clientId}/withdrawals/manual`, payload)
        setToast({ type: 'success', message: 'Manual withdrawal recorded successfully.' })
        setManualForm(prev => ({
          ...prev,
          amount: '',
          accountName: '',
          accountNameAlias: '',
          accountNumber: '',
          bankCode: '',
          bankName: '',
          branchName: '',
          withdrawFeePercent: '',
          withdrawFeeFlat: '',
          pgFee: '',
        }))
        setPage(1)
        await loadWithdrawals({ page: 1 })
      } catch (err: any) {
        const data = err?.response?.data
        const messages: string[] = []
        if (Array.isArray(data?.errors) && data.errors.length) {
          messages.push(...data.errors.map((e: any) => e.msg))
        }
        if (data?.error) messages.push(data.error)
        setToast({ type: 'error', message: messages.join(', ') || 'Failed to record manual withdrawal.' })
      } finally {
        setManualSubmitting(false)
      }
    },
    [clientId, manualForm, loadWithdrawals]
  )

  const exportToExcel = () => {
    const rows = [
      ['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name', 'Wallet', 'Source', 'Amount', 'Fee', 'Net Amount', 'Status'],
      ...withdrawals.map(w => [
        new Date(w.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
        w.completedAt ? new Date(w.completedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-',
        w.refId,
        w.bankName,
        w.accountNumber,
        w.accountName,
        w.sourceProvider === 'manual' ? 'Manual Entry' : w.wallet,
        w.sourceProvider ?? '',
        w.amount,
        w.amount - (w.netAmount ?? 0),
        w.netAmount ?? 0,
        w.status,
      ]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Withdrawals')
    XLSX.writeFile(wb, 'withdrawals.xlsx')
  }

  const inputClasses =
    'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'

  const selectClasses =
    'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'

  const buttonClasses =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:bg-indigo-500/60'

  const paginationButtonClasses =
    'flex h-10 w-10 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:border-neutral-800/60 disabled:text-neutral-500 disabled:hover:bg-neutral-900'

  return (
    <ClientLayout>
      <div className="relative min-h-screen space-y-6 bg-neutral-950 p-6 text-neutral-100">
        {pageError && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {pageError}
          </p>
        )}

        {toast && (
          <div
            role="status"
            className={`fixed right-6 top-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border px-5 py-4 text-sm shadow-xl backdrop-blur ${
              toast.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900/70">
              {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            </span>
            <div className="leading-relaxed">{toast.message}</div>
          </div>
        )}

        {wallets.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {wallets.map(w => (
              <div
                key={w.id}
                className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm backdrop-blur transition hover:border-indigo-500/40 hover:shadow-lg"
              >
                <h4 className="text-sm font-semibold text-neutral-200">
                  {w.name ||
                    (w.provider
                      ? w.provider.charAt(0).toUpperCase() + w.provider.slice(1)
                      : `Sub-wallet ${w.id.substring(0, 6)}`)}
                </h4>
                <p className="mt-2 text-2xl font-semibold text-neutral-50">Rp {w.balance.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/80 shadow-xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-6 py-5">
            <h3 className="text-lg font-semibold text-neutral-50">Manual Withdrawal Entry</h3>
            <div className="text-sm text-neutral-300">
              Net Amount <strong className="text-neutral-50">Rp {manualNetAmount.toLocaleString('id-ID')}</strong>
            </div>
          </div>
          <form onSubmit={handleManualSubmit} className="grid gap-4 px-6 py-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Sub-wallet</label>
              <select
                className={selectClasses}
                value={manualForm.subMerchantId}
                onChange={e => setManualForm(prev => ({ ...prev, subMerchantId: e.target.value }))}
              >
                <option value="">Select sub-wallet</option>
                {wallets.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name || (w.provider ? w.provider.charAt(0).toUpperCase() + w.provider.slice(1) : w.id.slice(0, 6))}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Amount (Rp)</label>
              <input
                className={inputClasses}
                type="number"
                min="0"
                value={manualForm.amount}
                onChange={e => setManualForm(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Account Name</label>
              <input
                className={inputClasses}
                value={manualForm.accountName}
                onChange={e => setManualForm(prev => ({ ...prev, accountName: e.target.value }))}
                placeholder="Beneficiary name"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Account Alias</label>
              <input
                className={inputClasses}
                value={manualForm.accountNameAlias}
                onChange={e => setManualForm(prev => ({ ...prev, accountNameAlias: e.target.value }))}
                placeholder="Alias (optional)"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Account Number</label>
              <input
                className={inputClasses}
                value={manualForm.accountNumber}
                onChange={e => setManualForm(prev => ({ ...prev, accountNumber: e.target.value }))}
                placeholder="1234567890"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Bank Code</label>
              <input
                className={inputClasses}
                value={manualForm.bankCode}
                onChange={e => setManualForm(prev => ({ ...prev, bankCode: e.target.value }))}
                placeholder="Bank code"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Bank Name</label>
              <input
                className={inputClasses}
                value={manualForm.bankName}
                onChange={e => setManualForm(prev => ({ ...prev, bankName: e.target.value }))}
                placeholder="Bank name"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Branch Name</label>
              <input
                className={inputClasses}
                value={manualForm.branchName}
                onChange={e => setManualForm(prev => ({ ...prev, branchName: e.target.value }))}
                placeholder="Branch (optional)"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Withdraw Fee %</label>
              <input
                className={inputClasses}
                type="number"
                min="0"
                step="0.01"
                value={manualForm.withdrawFeePercent}
                onChange={e => setManualForm(prev => ({ ...prev, withdrawFeePercent: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">Withdraw Fee Flat</label>
              <input
                className={inputClasses}
                type="number"
                min="0"
                step="0.01"
                value={manualForm.withdrawFeeFlat}
                onChange={e => setManualForm(prev => ({ ...prev, withdrawFeeFlat: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-neutral-300">PG Fee</label>
              <input
                className={inputClasses}
                type="number"
                min="0"
                step="0.01"
                value={manualForm.pgFee}
                onChange={e => setManualForm(prev => ({ ...prev, pgFee: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="flex items-center justify-end md:col-span-2">
              <button type="submit" className={buttonClasses} disabled={manualSubmitting}>
                {manualSubmitting ? 'Saving…' : 'Record Withdrawal'}
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/80 shadow-xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-6 py-5">
            <h3 className="text-lg font-semibold text-neutral-50">Withdrawal History</h3>
            <button onClick={exportToExcel} className={buttonClasses} type="button">
              <FileText size={16} /> Excel
            </button>
          </div>

          <div className="flex flex-col gap-3 border-b border-neutral-800 bg-neutral-950/40 px-6 py-5 md:flex-row md:items-center">
            <input
              className={`${inputClasses} md:w-48`}
              placeholder="Search Ref"
              value={searchRef}
              onChange={e => {
                setSearchRef(e.target.value)
                setPage(1)
              }}
            />
            <select
              className={`${selectClasses} md:w-44`}
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="">All Status</option>
              <option>PENDING</option>
              <option>COMPLETED</option>
              <option>FAILED</option>
            </select>
            <DatePicker
              className={`${inputClasses} w-full md:w-56`}
              calendarClassName="!bg-neutral-900 !text-neutral-100"
              dayClassName={() => '!text-neutral-100 hover:!bg-indigo-600/60'}
              selectsRange
              startDate={startDate}
              endDate={endDate}
              onChange={(update: [Date | null, Date | null]) => {
                setDateRange(update)
                if (update[0] && update[1]) {
                  setPage(1)
                }
              }}
              isClearable
              placeholderText="Select Date Range..."
              maxDate={new Date()}
              dateFormat="dd-MM-yyyy"
            />
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <p className="px-6 py-8 text-sm text-neutral-400">Loading…</p>
            ) : (
              <table className="min-w-full divide-y divide-neutral-800">
                <thead className="bg-neutral-900/70">
                  <tr>
                    {['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name', 'Wallet', 'Source', 'Amount', 'Fee', 'Net Amount', 'Status'].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400"
                      >
                        <span className="flex items-center gap-2">
                          {h}
                          <ArrowUpDown size={14} className="h-3.5 w-3.5 text-neutral-600" />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900/60 bg-neutral-950/60">
                  {withdrawals.length ? (
                    withdrawals.map(w => (
                      <tr key={w.refId} className="hover:bg-neutral-900/60">
                        <td className="px-4 py-3 text-sm text-neutral-200">
                          {new Date(w.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-200">
                          {w.completedAt
                            ? new Date(w.completedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-200">{w.refId}</td>
                        <td className="px-4 py-3 text-sm text-neutral-200">{w.bankName}</td>
                        <td className="px-4 py-3 text-sm text-neutral-200">{w.accountNumber}</td>
                        <td className="px-4 py-3 text-sm text-neutral-200">{w.accountName}</td>
                        <td className="px-4 py-3 text-sm text-neutral-200">
                          {w.sourceProvider === 'manual' ? 'Manual Entry' : w.wallet}
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-200">{w.sourceProvider ?? '-'}</td>
                        <td className="px-4 py-3 text-sm text-neutral-100">Rp {w.amount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-sm text-neutral-100">
                          Rp {(w.amount - (w.netAmount ?? 0)).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-100">
                          Rp {(w.netAmount ?? 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              statusBadgeClasses[w.status] ?? 'border-neutral-700 bg-neutral-800 text-neutral-200'
                            }`}
                          >
                            {w.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-sm text-neutral-400">
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex flex-col gap-4 border-t border-neutral-800 bg-neutral-900/60 px-6 py-5 text-sm text-neutral-300 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <span>Rows</span>
              <select
                className={`${selectClasses} w-24`}
                value={perPage}
                onChange={e => {
                  setPerPage(+e.target.value)
                  setPage(1)
                }}
              >
                {[5, 10, 20].map(n => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                className={paginationButtonClasses}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                type="button"
              >
                ‹
              </button>
              <span className="text-sm font-semibold text-neutral-200">
                {page}/{totalPages}
              </span>
              <button
                className={paginationButtonClasses}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                type="button"
              >
                ›
              </button>
            </div>
          </div>
        </section>
      </div>
    </ClientLayout>
  )
}

AdminClientWithdrawPage.disableLayout = true
export default AdminClientWithdrawPage
