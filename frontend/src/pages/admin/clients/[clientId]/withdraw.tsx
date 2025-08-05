'use client'
import { NextPage } from 'next'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import api from '@/lib/api'
import ClientLayout from '@/components/layouts/ClientLayout'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { FileText, ArrowUpDown } from 'lucide-react'
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

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    setPageError('')
    const params: any = { page, limit: perPage }
    if (statusFilter) params.status = statusFilter
    if (searchRef) params.ref = searchRef
    if (startDate) params.fromDate = startDate.toISOString()
    if (endDate) params.toDate = endDate.toISOString()

    api
      .get<{ data: Withdrawal[]; total: number }>(`/admin/clients/${clientId}/withdrawals`, {
        params
      })
      .then(res => {
        setWithdrawals(res.data.data)
        setTotalPages(Math.max(1, Math.ceil(res.data.total / perPage)))
      })
      .catch(() => setPageError('Failed to load data'))
      .finally(() => setLoading(false))
  }, [clientId, searchRef, statusFilter, startDate, endDate, page, perPage])

  useEffect(() => {
    if (!clientId) return
    api
      .get<SubWallet[]>(`/admin/clients/${clientId}/subwallets`)
      .then(res => setWallets(res.data))
      .catch(() => {})
  }, [clientId])

  const exportToExcel = () => {
    const rows = [
      ['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name', 'Wallet', 'Amount', 'Fee', 'Net Amount', 'Status'],
      ...withdrawals.map(w => [
        new Date(w.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
        w.completedAt ? new Date(w.completedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-',
        w.refId,
        w.bankName,
        w.accountNumber,
        w.accountName,
        w.wallet,
        w.amount,
        w.amount - w.netAmount,
        w.netAmount,
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
                    {['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name', 'Wallet', 'Amount', 'Fee', 'Net Amount', 'Status'].map(h => (
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
                        <td>{w.wallet}</td>
                        <td>Rp {w.amount.toLocaleString()}</td>
                        <td>Rp {(w.amount - w.netAmount).toLocaleString()}</td>
                        <td>Rp {w.netAmount.toLocaleString()}</td>
                        <td>
                          <span className={styles[`s${w.status}`]}>{w.status}</span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={11} className={styles.noData}>No data</td>
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
