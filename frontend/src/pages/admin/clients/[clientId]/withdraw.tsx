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
import styles from '../../../client/WithdrawPage.module.css'

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
  const [dateRange, setDateRange] = useState<[Date|null,Date|null]>([null,null])
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
      const params: any = { page: currentPage, limit: currentLimit, search: searchRef }
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
          setManualForm(prev => prev.subMerchantId ? prev : { ...prev, subMerchantId: res.data[0].id })
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
      ])
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Withdrawals')
    XLSX.writeFile(wb, 'withdrawals.xlsx')
  }



  return (
    <ClientLayout>
      <div className={styles.page}>
        {pageError && <p className={styles.pageError}>{pageError}</p>}
        {toast && (
          <div
            className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}
            role="status"
          >
            <span className={styles.toastIcon}>
              {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            </span>
            <div>{toast.message}</div>
          </div>
        )}
        {wallets.length > 0 && (
          <div className={styles.statsGrid}>
            <div className={`${styles.statCard} ${styles.activeCard}`}>
              {wallets.map(w => (
                <div key={w.id} className={styles.statCard}>
                  <h4>
                    {w.name || (w.provider ? w.provider.charAt(0).toUpperCase() + w.provider.slice(1) : `Sub-wallet ${w.id.substring(0,6)}`)}
                  </h4>
                  <p>Rp {w.balance.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <section className={styles.historyCard}>
          <div className={styles.manualHeader}>
            <h3>Manual Withdrawal Entry</h3>
            <div className={styles.manualSummary}>
              Net Amount:{' '}
              <strong>Rp {manualNetAmount.toLocaleString('id-ID')}</strong>
            </div>
          </div>
          <form onSubmit={handleManualSubmit} className={styles.manualGrid}>
            <div className={styles.manualField}>
              <label>Sub-wallet</label>
              <select
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
            <div className={styles.manualField}>
              <label>Amount (Rp)</label>
              <input
                type="number"
                min="0"
                value={manualForm.amount}
                onChange={e => setManualForm(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className={styles.manualField}>
              <label>Account Name</label>
              <input
                value={manualForm.accountName}
                onChange={e => setManualForm(prev => ({ ...prev, accountName: e.target.value }))}
                placeholder="Beneficiary name"
              />
            </div>
            <div className={styles.manualField}>
              <label>Account Alias</label>
              <input
                value={manualForm.accountNameAlias}
                onChange={e => setManualForm(prev => ({ ...prev, accountNameAlias: e.target.value }))}
                placeholder="Alias (optional)"
              />
            </div>
            <div className={styles.manualField}>
              <label>Account Number</label>
              <input
                value={manualForm.accountNumber}
                onChange={e => setManualForm(prev => ({ ...prev, accountNumber: e.target.value }))}
                placeholder="1234567890"
              />
            </div>
            <div className={styles.manualField}>
              <label>Bank Code</label>
              <input
                value={manualForm.bankCode}
                onChange={e => setManualForm(prev => ({ ...prev, bankCode: e.target.value }))}
                placeholder="Bank code"
              />
            </div>
            <div className={styles.manualField}>
              <label>Bank Name</label>
              <input
                value={manualForm.bankName}
                onChange={e => setManualForm(prev => ({ ...prev, bankName: e.target.value }))}
                placeholder="Bank name"
              />
            </div>
            <div className={styles.manualField}>
              <label>Branch Name</label>
              <input
                value={manualForm.branchName}
                onChange={e => setManualForm(prev => ({ ...prev, branchName: e.target.value }))}
                placeholder="Branch (optional)"
              />
            </div>
            <div className={styles.manualField}>
              <label>Withdraw Fee %</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualForm.withdrawFeePercent}
                onChange={e => setManualForm(prev => ({ ...prev, withdrawFeePercent: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className={styles.manualField}>
              <label>Withdraw Fee Flat</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualForm.withdrawFeeFlat}
                onChange={e => setManualForm(prev => ({ ...prev, withdrawFeeFlat: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className={styles.manualField}>
              <label>PG Fee</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualForm.pgFee}
                onChange={e => setManualForm(prev => ({ ...prev, pgFee: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className={styles.manualActions}>
              <button type="submit" className={styles.manualSubmit} disabled={manualSubmitting}>
                {manualSubmitting ? 'Saving…' : 'Record Withdrawal'}
              </button>
            </div>
          </form>
        </section>

        <section className={styles.historyCard}>
          <div className={styles.historyHeader}>
            <h3>Withdrawal History</h3>
            <button onClick={exportToExcel} className={styles.exportBtn}>
              <FileText size={16} /> Excel
            </button>
          </div>

          <div className={styles.withdrawFilters}>
            <input
              placeholder="Search Ref"
              value={searchRef}
              onChange={e => { setSearchRef(e.target.value); setPage(1) }}
            />
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            >
              <option value="">All Status</option>
              <option>PENDING</option>
              <option>COMPLETED</option>
              <option>FAILED</option>
            </select>
            <DatePicker
              selectsRange
              startDate={startDate}
              endDate={endDate}
              onChange={(update: [Date|null,Date|null]) => {
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

          <div className={styles.tableWrap}>
            {loading ? (
              <p>Loading…</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    {['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name', 'Wallet', 'Source', 'Amount', 'Fee', 'Net Amount', 'Status'].map(h => (
                      <th key={h}>
                        {h}
                        <ArrowUpDown size={14} className={styles.sortIcon} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.length ? (
                    withdrawals.map(w => (
                      <tr key={w.refId}>
                        <td>{new Date(w.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>{w.completedAt ? new Date(w.completedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                        <td>{w.refId}</td>
                        <td>{w.bankName}</td>
                        <td>{w.accountNumber}</td>
                        <td>{w.accountName}</td>
                        <td>{w.sourceProvider === 'manual' ? 'Manual Entry' : w.wallet}</td>
                        <td>{w.sourceProvider ?? '-'}</td>
                        <td>Rp {w.amount.toLocaleString()}</td>
                        <td>Rp {(w.amount - (w.netAmount ?? 0)).toLocaleString()}</td>
                        <td>Rp {(w.netAmount ?? 0).toLocaleString()}</td>
                        <td>
                          <span className={styles[`s${w.status}`]}>{w.status}</span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={12} className={styles.noData}>No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className={styles.pagination}>
            <div>
              Rows
              <select
                value={perPage}
                onChange={e => { setPerPage(+e.target.value); setPage(1) }}
              >
                {[5, 10, 20].map(n => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
              <span>{page}/{totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
            </div>
          </div>
        </section>
      </div>
    </ClientLayout>
  )
}

AdminClientWithdrawPage.disableLayout = true
export default AdminClientWithdrawPage
