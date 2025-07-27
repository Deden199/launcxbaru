'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/apiClient'
import styles from './ClientDashboard.module.css'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

import {
  ClipboardCopy,
  Wallet,
  Clock,
  ListChecks,
  FileText,
} from 'lucide-react'

type Tx = {
  id:               string
  date:             string
  reference:        string
  rrn:              string
  playerId:         string
  amount:           number
  feeLauncx:        number
  netSettle:        number
  status: '' | 'SUCCESS' | 'DONE' | 'PAID' | 'PENDING' | 'EXPIRED'   // <<< REVISI: tambahkan semua kemungkinan
  settlementStatus?: string
    paymentReceivedTime?: string
  settlementTime?: string
  trxExpirationTime?: string
}

type ClientOption = { id: string; name: string }

export default function ClientDashboardPage() {
  const router = useRouter()

  // Parent–Child
  const [children, setChildren]               = useState<ClientOption[]>([])
  const [selectedChild, setSelectedChild]     = useState<'all' | string>('all')
const [dateRange, setDateRange] = useState<[Date|null,Date|null]>([null,null])
const [startDate, endDate]     = dateRange

  // Summary
  const [balance, setBalance]                 = useState(0)
  const [totalPend, setTotalPend]             = useState(0)

  // Transactions
  const [txs, setTxs]                         = useState<Tx[]>([])
  const [totalTrans, setTotalTrans]           = useState(0)

  const [loadingSummary, setLoadingSummary]   = useState(true)
  const [loadingTx, setLoadingTx]             = useState(true)

  // Date filter
    function toJakartaDate(d: Date): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(d)
  }
  const [range, setRange]                     = useState<'today'|'week'|'custom'>('today')
  const [from, setFrom]                       = useState(() => toJakartaDate(new Date()))
  const [to, setTo]                           = useState(() => toJakartaDate(new Date()))
  const [statusFilter, setStatusFilter] = useState('PAID')    // <<< REVISI: default filter PAID

  // Search
  const [search, setSearch]                   = useState('')

const buildParams = () => {
  const tz = 'Asia/Jakarta'
  const params: any = {}

  if (range === 'today') {
    // 00:00:00 → sekarang
    const start = new Date(); start.setHours(0,0,0,0)
    const end   = new Date()
    // konversi ke Jakarta lalu toISOString
    const startJakarta = new Date(start.toLocaleString('en-US', { timeZone: tz }))
    const endJakarta   = new Date(end.toLocaleString('en-US',   { timeZone: tz }))

    params.date_from = startJakarta.toISOString()
    params.date_to   = endJakarta.toISOString()
  }
  else if (range === 'week') {
    const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0)
    const end   = new Date()

    const startJakarta = new Date(start.toLocaleString('en-US', { timeZone: tz }))
    const endJakarta   = new Date(end.toLocaleString('en-US',   { timeZone: tz }))

    params.date_from = startJakarta.toISOString()
    params.date_to   = endJakarta.toISOString()
  }
  else if (startDate && endDate) {
    // custom: hari pertama 00:00, hari terakhir 23:59:59
    const s = new Date(startDate); s.setHours(0,0,0,0)
    const e = new Date(endDate);   e.setHours(23,59,59,999)
    const sJak = new Date(s.toLocaleString('en-US', { timeZone: tz }))
    const eJak = new Date(e.toLocaleString('en-US', { timeZone: tz }))

    params.date_from = sJak.toISOString()
    params.date_to   = eJak.toISOString()
  }
 if (statusFilter) {
   params.status = statusFilter   // kirim 1 status. (Kalau mau multi, kirim array/comma)
 }
  if (selectedChild !== 'all') {
    params.clientId = selectedChild
  }
  console.log('buildParams →', params)
  return params
}


  // Fetch summary (with children) in one call
  const fetchSummary = async () => {
    setLoadingSummary(true)
    try {
      const { data } = await api.get<{
        balance: number
        totalPending: number
        children: ClientOption[]
      }>('/client/dashboard', { params: buildParams() })

      setBalance(data.balance)
      setTotalPend(data.totalPending)
      setChildren(data.children)
    } catch {
      router.push('/client/login')
    } finally {
      setLoadingSummary(false)
    }
  }

  // Fetch transactions
  const fetchTransactions = async () => {
    setLoadingTx(true)
    try {
      const { data } = await api.get<{ transactions: Tx[] }>(
        '/client/dashboard',
        { params: buildParams() }
      )
      setTxs(data.transactions)
      setTotalTrans(data.transactions.length)
    } catch {
      router.push('/client/login')
    } finally {
      setLoadingTx(false)
    }
  }

  // Export Excel
  const handleExport = async () => {
    const token = localStorage.getItem('clientToken')
    if (!token) return router.push('/client/login')
    try {
      const resp = await api.get('/client/dashboard/export', {
        params: buildParams(),
        responseType: 'blob'
      })
      const blob = new Blob([resp.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'client-transactions.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('Gagal export data')
    }
  }

  // Copy helper
  const copyText = (txt: string) => {
    navigator.clipboard.writeText(txt)
      .then(() => alert('Disalin!'))
      .catch(() => alert('Gagal menyalin'))
  }

    const retryCallback = async (id: string) => {
    try {
      await api.post(`/client/callbacks/${id}/retry`)
      alert('Callback terkirim')
    } catch {
      alert('Gagal retry callback')
    }
  }

  // Trigger fetches when filters change
  useEffect(() => { fetchSummary() }, [range, selectedChild, from, to])
  useEffect(() => { fetchTransactions() }, [range, selectedChild, from, to])

  const filtered = txs.filter(t =>
  (statusFilter === '' || t.status === statusFilter) &&         // <<< REVISI: filter berdasarkan status, bukan settlementStatus
    (
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      t.rrn.toLowerCase().includes(search.toLowerCase()) ||
      t.playerId.toLowerCase().includes(search.toLowerCase())
    )
  )
const totalTransaksiCount = filtered.length // <<< CHANGED

  if (loadingSummary) return <div className={styles.loader}>Loading summary…</div>

  return (
    <div className={styles.container}>
      {/* Dropdown Child */}
      {children.length > 0 && (
        <div className={styles.childSelector}>
          <label>Pilih Child:&nbsp;</label>
          <select
            value={selectedChild}
            onChange={e => setSelectedChild(e.target.value as any)}
          >
            <option value="all">Semua Child</option>
            {children.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <aside className={styles.sidebar}>
        <section className={styles.statsGrid}>
          {/* <div className={`${styles.card} ${styles.activeBalance}`}>
            <Wallet className={styles.cardIcon} />
            <h2>
  Active Balance
  {children.length > 0 && (
    <>
      {' '}
      {selectedChild === 'all'
        ? '(Semua Child)'
        : `(${children.find(c => c.id === selectedChild)?.name})`}
    </>
  )}
</h2>

            <p>{balance.toLocaleString('id-ID',{ style:'currency', currency:'IDR' })}</p>
          </div> */}
          <div className={styles.card}>
            <ListChecks className={styles.cardIcon} /><h2>Transactions</h2>
 <p>{totalTransaksiCount}</p>             {/* <<< CHANGED */}
          </div>
          <div className={`${styles.card} ${styles.pendingBalance}`}>
            <Clock className={styles.cardIcon} /><h2>Pending Settlement</h2>
            <p>{totalPend.toLocaleString('id-ID',{ style:'currency', currency:'IDR' })}</p>
          </div>
        </section>
      </aside>

      <main className={styles.content}>
        <section className={styles.filters}>
          <div className={styles.rangeControls}>
           <select value={range} onChange={e => setRange(e.target.value as any)}>
  <option value="today">Today</option>
  <option value="week">7 Day</option>
  <option value="custom">Custom</option>
</select>

{range === 'custom' && (
  <div className={styles.customDatePicker}>
    <DatePicker
      selectsRange
      startDate={startDate}
      endDate={endDate}
      onChange={(upd) => setDateRange(upd)}
      isClearable={false}           // <-- matikan clear bawaan
      placeholderText="Select Date Range…"
      maxDate={new Date()}
      dateFormat="dd-MM-yyyy"
      className={styles.dateInput}
    />
    {/* tombol clear buatan kita */}
    {(startDate || endDate) && (
      <button
        type="button"
        className={styles.clearRangeBtn}
        onClick={() => setDateRange([null, null])}
      >
        Clear
      </button>
    )}
    <button
      type="button"
      className={styles.applyBtn}
      onClick={fetchTransactions}
      disabled={!startDate || !endDate}
    >
      Terapkan
    </button>
  </div>
)}


            <button className={styles.exportBtn} onClick={handleExport}>
              <FileText size={16} /> Export Excel
            </button>
          </div>
<select
  value={statusFilter}
  onChange={e => setStatusFilter(e.target.value)}
>
  <option value="">All Status</option>
  <option value="SUCCESS">SUCCESS</option>
  <option value="PAID">PAID</option>           {/* <<< REVISI: tambahkan PAID */}
  <option value="PENDING">PENDING</option>
  <option value="EXPIRED">EXPIRED</option>
</select>

          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search TRX ID, RRN, atau Player ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </section>

        <section className={styles.tableSection}>
          <h2>Transaction List &amp; Settlement</h2>
          {loadingTx ? (
            <div className={styles.loader}>Loading transactions…</div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                                        <th>Paid At</th>
                    <th>Settled At</th>
                    <th>TRX ID</th>
                    <th>RRN</th>
                    <th>Player ID</th>
                    <th>Amount</th>
                    <th>Fee</th>
                    <th>Net Amount</th>
                    <th>Status</th>
                    <th>Settlement Status</th>
                    <th>Action</th>

                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.id}>
                      <td>{new Date(t.date).toLocaleString('id-ID',{ dateStyle:'short', timeStyle:'short' })}</td>
                                            <td>{t.paymentReceivedTime ? new Date(t.paymentReceivedTime).toLocaleString('id-ID',{ dateStyle:'short', timeStyle:'short' }) : '-'}</td>
                      <td>{t.settlementTime ? new Date(t.settlementTime).toLocaleString('id-ID',{ dateStyle:'short', timeStyle:'short' }) : '-'}</td>
                      <td>
                        <code className="font-mono">{t.id}</code>
                        <button className={styles.copyBtn} onClick={() => copyText(t.id)} title="Copy TRX ID">
                          <ClipboardCopy size={14}/>
                        </button>
                      </td>
                      <td>
                        <div className={styles.rrnCell}>
                          <span className={styles.ellipsis}>{t.rrn}</span>
                          <button className={styles.copyBtn} onClick={() => copyText(t.rrn)} title="Copy RRN">
                            <ClipboardCopy size={14}/>
                          </button>
                        </div>
                      </td>
                      <td>{t.playerId}</td>
                      <td>{t.amount.toLocaleString('id-ID',{ style:'currency', currency:'IDR' })}</td>
                      <td>{t.feeLauncx.toLocaleString('id-ID',{ style:'currency', currency:'IDR' })}</td>
                      <td className={styles.netSettle}>{t.netSettle.toLocaleString('id-ID',{ style:'currency', currency:'IDR' })}</td>
<td>
  {t.status === 'SUCCESS'   ? 'SUCCESS'
    : t.status === 'PAID'    ? 'PAID'          /* <<< REVISI: tampilkan PAID */
    : t.status === 'PENDING' ? 'PENDING'
    : t.status === 'EXPIRED' ? 'EXPIRED'
    : '-'}
</td>
<td>
  {t.settlementStatus === 'WAITING'
    ? 'PENDING'
    : t.settlementStatus === 'UNSUCCESSFUL'
      ? 'FAILED'
      : (t.settlementStatus || '-')}
</td>                   

                      <td>
                        {['PAID', 'DONE', 'SETTLED', 'SUCCESS'].includes(t.status) && (
                          <button
                            className={styles.retryBtn}
                            onClick={() => retryCallback(t.id)}
                          >
                            Retry Callback
                          </button>
                        )}
                      </td>
 </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
    
  )
}
