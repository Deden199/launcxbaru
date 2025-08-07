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

type RawStatus = '' | 'SUCCESS' | 'DONE' | 'SETTLED' | 'PAID' | 'PENDING' | 'EXPIRED'
type Tx = {
  id:               string
  date:             string
  reference:        string
  rrn:              string
  playerId:         string
  amount:           number
  feeLauncx:        number
  netSettle:        number
  status: RawStatus
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
  const [totalTrans, setTotalTrans]           = useState(0) // from backend (count)
    const [totalSettlement, setTotalSettlement] = useState(0)
  const [totalPaid, setTotalPaid]             = useState(0)
  const [exporting, setExporting]             = useState(false)
  // Transactions
  const [txs, setTxs]                         = useState<Tx[]>([])
  const [page, setPage]                       = useState(1)
  const [perPage, setPerPage]                 = useState(10)
  const [totalPages, setTotalPages]           = useState(1)
  const [loadingSummary, setLoadingSummary]   = useState(true)
  const [loadingTx, setLoadingTx]             = useState(true)

  // Date filter
  function toJakartaDate(d: Date): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(d)
  }
  const [range, setRange]                     = useState<'today'|'week'|'custom'>('today')
  const [from, setFrom]                       = useState(() => toJakartaDate(new Date()))
  const [to, setTo]                           = useState(() => toJakartaDate(new Date()))
  const [statusFilter, setStatusFilter] = useState<string>('PAID')    // default filter PAID

  // Search
  const [search, setSearch]                   = useState('')

  // helper: normalisasi DONE / SETTLED => SUCCESS
  const normalizeStatus = (s: string): string => {
    if (s === 'DONE' || s === 'SETTLED') return 'SUCCESS'
    return s
  }

    const handleApply = () => {
    fetchSummary()
    fetchTransactions()
  }

  const buildParams = () => {
    const tz = 'Asia/Jakarta'
    const params: any = {}

    if (range === 'today') {
      const start = new Date(); start.setHours(0,0,0,0)
      const end   = new Date()
      const startJakarta = new Date(start.toLocaleString('en-US', { timeZone: tz }))
      const endJakarta   = new Date(end.toLocaleString('en-US',   { timeZone: tz }))

      params.date_from = startJakarta.toISOString()
      params.date_to   = endJakarta.toISOString()
    } else if (range === 'week') {
      const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0)
      const end   = new Date()
      const startJakarta = new Date(start.toLocaleString('en-US', { timeZone: tz }))
      const endJakarta   = new Date(end.toLocaleString('en-US',   { timeZone: tz }))

      params.date_from = startJakarta.toISOString()
      params.date_to   = endJakarta.toISOString()
    } else if (startDate && endDate) {
      const s = new Date(startDate); s.setHours(0,0,0,0)
      const e = new Date(endDate);   e.setHours(23,59,59,999)
      const sJak = new Date(s.toLocaleString('en-US', { timeZone: tz }))
      const eJak = new Date(e.toLocaleString('en-US', { timeZone: tz }))

      params.date_from = sJak.toISOString()
      params.date_to   = eJak.toISOString()
    }

    if (statusFilter) {
      if (statusFilter === 'SUCCESS') {
        params.status = ['SUCCESS', 'DONE', 'SETTLED']
      } else {
        params.status = statusFilter
      }
    }

    if (selectedChild !== 'all') {
      params.clientId = selectedChild
    }
    if (search.trim()) {
      params.search = search.trim()
    }
    params.page  = page
    params.limit = perPage
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
        totalCount: number
        totalSettlement?: number
        totalPaid?: number
        children: ClientOption[]
      }>('/client/dashboard', { params: buildParams() })

      setBalance(data.balance)
      setTotalPend(data.totalPending)
      setTotalSettlement(data.totalSettlement || 0)
      setTotalPaid(data.totalPaid || 0)
      setChildren(data.children)
      setTotalTrans(data.totalCount)
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
      const { data } = await api.get<{ transactions: Tx[]; total: number }>(
        '/client/dashboard',
        { params: buildParams() }
      )
      setTxs(data.transactions)
      setTotalPages(Math.max(1, Math.ceil(data.total / perPage)))
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
setExporting(true)
    
let timeoutId: ReturnType<typeof setTimeout> | null = null

try {
  const controller = new AbortController()
  timeoutId = setTimeout(() => controller.abort(), 60000) // 60s safety

  const resp = await api.get('/client/dashboard/export', {
    params: buildParams(),
    responseType: 'blob',
    signal: controller.signal,
    timeout: 0, // override default axios timeout if any
  })

  // kalau sudah berhasil, bersihkan timeout
  if (timeoutId) {
    clearTimeout(timeoutId)
    timeoutId = null
  }

  const contentDisp = resp.headers['content-disposition'] || ''
  const match = /filename="?([^"]+)"?/.exec(contentDisp)
  const filename = match ? match[1] : 'client-transactions.xlsx'

  const blob = new Blob([resp.data], {
    type: resp.headers['content-type'] || undefined,
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
} catch (e: any) {
  if (e?.name === 'CanceledError' || e?.name === 'AbortError') {
    alert('Export timeout. Coba range lebih kecil atau gunakan export background.')
  } else {
    console.error('Export failed', e)
    alert('Gagal export data: ' + (e?.message || 'Unknown error'))
  }
} finally {
  // pastikan timeout selalu dibersihkan
  if (timeoutId) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
  setExporting(false)
}
  }
  // Copy helper
  const copyText = (txt: string) => {
    navigator.clipboard.writeText(txt)
      .then(() => alert('Disalin!'))
      .catch(() => alert('Gagal menyalin'))
  }

  // Trigger fetches when filters change
  useEffect(() => { fetchSummary() }, [range, selectedChild, from, to, statusFilter])
  useEffect(() => { fetchTransactions() }, [range, selectedChild, from, to, search, page, perPage, statusFilter])

  const filtered = txs.filter(t =>
    (statusFilter === '' || normalizeStatus(t.status) === statusFilter) &&
    (
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      t.rrn.toLowerCase().includes(search.toLowerCase()) ||
      t.playerId.toLowerCase().includes(search.toLowerCase())
    )
  )

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
          <div className={styles.card}>
            <ListChecks className={styles.cardIcon} />
            <h2>Transactions</h2>
                        <p>{totalTrans.toLocaleString()}</p>
          </div>
          <div className={`${styles.card} ${styles.pendingBalance}`}>
            <Clock className={styles.cardIcon} />
            <h2>Pending Settlement</h2>
                        <p>{totalPend.toLocaleString('id-ID',{ style:'currency', currency:'IDR' })}</p>
          </div>
                    <div className={`${styles.card} ${styles.paidBalance}`}>
            <Wallet className={styles.cardIcon} />
            <h2>Total Settlement</h2>
            <p>{totalSettlement.toLocaleString('id-ID',{ style:'currency', currency:'IDR' })}</p>
          </div>
{/* <div className={`${styles.card} ${styles.paidBalance}`}>
  <Wallet className={styles.cardIcon} />
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <h2 style={{ margin: 0 }}>Total Paid</h2>
    <small style={{ fontSize: 12, color: '#666' }}>after fee</small>
  </div>
  <p>{totalPaid.toLocaleString('id-ID',{ style:'currency', currency:'IDR' })}</p>
</div> */}

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
                  isClearable={false}
                  placeholderText="Select Date Range…"
                  maxDate={new Date()}
                  dateFormat="dd-MM-yyyy"
                  className={styles.dateInput}
                />
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
                  onClick={handleApply}
                  disabled={!startDate || !endDate}
                >
                  Terapkan
                </button>
              </div>
            )}

<button
  type="button"
  className={styles.exportBtn}
  onClick={handleExport}
  disabled={exporting}
  aria-busy={exporting}
  aria-label="Export to Excel"
>
  {exporting ? 'Exporting…' : (
    <>
      <FileText size={16} aria-hidden="true" /> Export Excel
    </>
  )}
</button>

          </div>

          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          >
            <option value="">All Status</option>
            <option value="SUCCESS">SUCCESS / DONE / SETTLED</option>
            <option value="PAID">PAID</option>
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
                        {['SUCCESS', 'DONE', 'SETTLED'].includes(t.status)
                          ? 'SUCCESS'
                          : t.status === 'PAID'
                            ? 'PAID'
                            : t.status === 'PENDING'
                              ? 'PENDING'
                              : t.status === 'EXPIRED'
                                ? 'EXPIRED'
                                : '-'}
                      </td>
                      <td>
                        {t.settlementStatus === 'WAITING'
                          ? 'PENDING'
                          : t.settlementStatus === 'UNSUCCESSFUL'
                            ? 'FAILED'
                            : (t.settlementStatus || '-')}
                      </td>
                      <td></td>
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
                onChange={e => { setPerPage(+e.target.value); setPage(1) }}
              >
                {[10, 20, 50].map(n => (
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
      </main>
    </div>
  )
}
