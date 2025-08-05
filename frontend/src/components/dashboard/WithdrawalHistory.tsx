import { useEffect, useState } from 'react'
import DatePicker from 'react-datepicker'
import api from '@/lib/api'
import { Withdrawal } from '@/types/dashboard'
import styles from '@/pages/Dashboard.module.css'
import 'react-datepicker/dist/react-datepicker.css'

export default function WithdrawalHistory(_: any) {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchRef, setSearchRef] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [startDate, endDate] = dateRange
  const [totalPages, setTotalPages] = useState(1)

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
        setTotalPages(Math.max(1, Math.ceil(data.total / perPage)))
      } catch (err) {
        setError('Failed to load withdrawals')
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [searchRef, statusFilter, startDate, endDate, page, perPage])

  return (
    <>
      <section className={styles.withdrawFilters}>
        {/* <input
          type="text"
          placeholder="Search Ref"
          value={searchRef}
          onChange={e => {
            setSearchRef(e.target.value)
            setPage(1)
          }}
        /> */}
        <select
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
          selectsRange
          startDate={startDate}
          endDate={endDate}
          onChange={(update: [Date | null, Date | null]) => {
            setDateRange(update)
            setPage(1)
          }}
          isClearable
          placeholderText="Select Date Range..."
          maxDate={new Date()}
          dateFormat="dd-MM-yyyy"
        />
      </section>
      <section className={styles.tableSection} style={{ marginTop: 32 }}>
        <h2>Withdrawal History</h2>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {loading ? (
          <div className={styles.loader}>Loading withdrawals…</div>
        ) : (
          <>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ref ID</th>
                    <th>Account Name</th>
                    <th>Alias</th>
                    <th>Account No.</th>
                    <th>Bank Code</th>
                    <th>Bank Name</th>
                    <th>Branch</th>
                    <th>Wallet/Submerchant</th>
                    <th>Withdrawal Fee</th>
                    <th>Amount</th>
                    <th>Net Amount</th>
                    <th>PG Fee</th>
                    <th>PG Trx ID</th>
                    <th>In Process</th>
                    <th>Status</th>
                    <th>Completed At</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.length ? (
                    withdrawals.map(w => (
                      <tr key={w.id}>
                        <td>
                          {new Date(w.createdAt).toLocaleString('id-ID', {
                            dateStyle: 'short',
                            timeStyle: 'short'
                          })}
                        </td>
                        <td>{w.refId}</td>
                        <td>{w.accountName}</td>
                        <td>{w.accountNameAlias}</td>
                        <td>{w.accountNumber}</td>
                        <td>{w.bankCode}</td>
                        <td>{w.bankName}</td>
                        <td>{w.branchName ?? '-'}</td>
                        <td>{w.wallet}</td>
                        <td>
                          {(w.amount - (w.netAmount ?? 0)).toLocaleString('id-ID', {
                            style: 'currency',
                            currency: 'IDR'
                          })}
                        </td>
                        <td>
                          {w.amount.toLocaleString('id-ID', {
                            style: 'currency',
                            currency: 'IDR'
                          })}
                        </td>
                        <td>
                          {w.netAmount != null
                            ? w.netAmount.toLocaleString('id-ID', {
                                style: 'currency',
                                currency: 'IDR'
                              })
                            : '-'}
                        </td>
                        <td>
                          {w.pgFee != null
                            ? w.pgFee.toLocaleString('id-ID', {
                                style: 'currency',
                                currency: 'IDR'
                              })
                            : '-'}
                        </td>
                        <td>{w.paymentGatewayId ?? '-'}</td>
                        <td>{w.isTransferProcess ? 'Yes' : 'No'}</td>
                        <td>{w.status}</td>
                        <td>
                          {w.completedAt
                            ? new Date(w.completedAt).toLocaleString('id-ID', {
                                dateStyle: 'short',
                                timeStyle: 'short'
                              })
                            : '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={17} className={styles.noData}>
                        No withdrawals
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className={styles.pagination}>
              <div>
                Rows
                <select
                  value={perPage}
                  onChange={e => {
                    setPerPage(+e.target.value)
                    setPage(1)
                  }}
                >
                  {[10, 20, 50].map(n => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ‹
                </button>
                <span>
                  {page}/{totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  )
}
