import { Dispatch, SetStateAction, useState } from 'react'
import { FileText, ClipboardCopy } from 'lucide-react'
import api from '@/lib/api'
import styles from '@/pages/Dashboard.module.css'
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
  onDateChange
}: TransactionsTableProps) {
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  return (
    <>
      <section className={styles.filters}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Cari TRX ID, RRN, atau Player ID…"
          value={search}
          onChange={e => {
            setPage(1)
            setSearch(e.target.value)
          }}
        />
        <select
          value={statusFilter}
          onChange={e => {
            setPage(1)
            setStatusFilter(e.target.value)
          }}
        >
          <option value="SUCCESS">SUCCESS</option>
          <option value="PAID">PAID</option>
          <option value="PENDING">PENDING</option>
          <option value="EXPIRED">EXPIRED</option>
        </select>
        <DatePicker
          selectsRange
          startDate={dateRange[0]}
          endDate={dateRange[1]}
          onChange={upd => {
            const range = upd as [Date | null, Date | null]
            setDateRange(range)
            onDateChange(range)
          }}
          isClearable={true}
          placeholderText="Filter tanggal…"
          className={styles.dateInput}
          maxDate={new Date()}
          dateFormat="dd-MM-yyyy"
        />
        <button
          onClick={() => {
            api
              .get('/admin/merchants/dashboard/export-all', {
                params: buildParams(),
                responseType: 'blob'
              })
              .then(r => {
                const url = URL.createObjectURL(new Blob([r.data]))
                const a = document.createElement('a')
                a.href = url
                a.download = 'dashboard-all.xlsx'
                a.click()
                URL.revokeObjectURL(url)
              })
          }}
          className={styles.exportBtn}
        >
          <FileText size={16} /> Export Semua
        </button>
      </section>

      <section className={styles.tableSection}>
        <h2>Daftar Transaksi &amp; Settlement</h2>
        {loadingTx ? (
          <div className={styles.loader}>Loading transaksi…</div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Update At</th>
                  <th>Settled At</th>
                  <th>TRX ID</th>
                  <th>RRN</th>
                  <th>Player ID</th>
                  <th>PG</th>
                  <th>Amount</th>
                  <th>Fee Launcx</th>
                  <th>Fee PG</th>
                  <th>Net Amount</th>
                  <th>Status</th>
                  <th>Settlement Status</th>
                </tr>
              </thead>
              <tbody>
                {txs.map(t => (
                  <tr key={t.id}>
                    <td>{new Date(t.date).toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' })}</td>
                    <td>
                      {t.paymentReceivedTime
                        ? new Date(t.paymentReceivedTime).toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' })
                        : '-'}
                    </td>
                    <td>
                      {t.settlementTime
                        ? new Date(t.settlementTime).toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' })
                        : '-'}
                    </td>
                    <td>
                      <code className="font-mono">{t.id}</code>
                      <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(t.id)}>
                        <ClipboardCopy size={14} />
                      </button>
                    </td>
                    <td>
                      <div className={styles.rrnCell}>
                        <span className={styles.ellipsis}>{t.rrn}</span>
                        <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(t.rrn)}>
                          <ClipboardCopy size={14} />
                        </button>
                      </div>
                    </td>
                    <td>{t.playerId}</td>
                    <td>{t.channel}</td>
                    <td>{t.amount.toLocaleString('id-ID', { style:'currency', currency:'IDR' })}</td>
                    <td>{t.feeLauncx.toLocaleString('id-ID', { style:'currency', currency:'IDR' })}</td>
                    <td>{t.feePg.toLocaleString('id-ID', { style:'currency', currency:'IDR' })}</td>
                    <td className={styles.netSettle}>{t.netSettle.toLocaleString('id-ID', { style:'currency', currency:'IDR' })}</td>
                    <td>{t.status || '-'}</td>
                    <td>
                      {t.settlementStatus === 'WAITING'
                        ? 'PENDING'
                        : t.settlementStatus === 'UNSUCCESSFUL'
                          ? 'FAILED'
                          : t.settlementStatus || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
            <span>{page}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              ›
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
