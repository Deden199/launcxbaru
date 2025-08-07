'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import ClientLayout from '@/components/layouts/ClientLayout'
import { useRequireAuth } from '@/hooks/useAuth'
import api from '@/lib/api'
import styles from '@/pages/client/ClientDashboard.module.css'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { ClipboardCopy, Wallet, Clock, ListChecks } from 'lucide-react'

interface Tx {
  id: string
  date: string
  reference: string
  rrn: string
  playerId: string
  amount: number
  feeLauncx: number
  netSettle: number
  status: '' | 'SUCCESS' | 'DONE' | 'PAID' | 'PENDING' | 'EXPIRED'
  settlementStatus?: string
  paymentReceivedTime?: string
  settlementTime?: string
  trxExpirationTime?: string
}

interface ClientOption { id: string; name: string }

const AdminClientDashboard = () => {
  useRequireAuth()
  const router = useRouter()
  const { clientId } = router.query as { clientId?: string }

  const [children, setChildren] = useState<ClientOption[]>([])
  const [selectedChild, setSelectedChild] = useState<'all' | string>('all')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [startDate, endDate] = dateRange

  const [balance, setBalance] = useState(0)
  const [totalPend, setTotalPend] = useState(0)

  const [txs, setTxs] = useState<Tx[]>([])
  const [totalTrans, setTotalTrans] = useState(0)

  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingTx, setLoadingTx] = useState(true)

  function toJakartaDate(d: Date): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(d)
  }
  const [range, setRange] = useState<'today' | 'week' | 'custom'>('today')
  const [from, setFrom] = useState(() => toJakartaDate(new Date()))
  const [to, setTo] = useState(() => toJakartaDate(new Date()))
  const [statusFilter, setStatusFilter] = useState('PAID')

  const [search, setSearch] = useState('')

  const buildParams = () => {
    const tz = 'Asia/Jakarta'
    const params: any = {}
    if (range === 'today') {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end = new Date()
      const startJak = new Date(start.toLocaleString('en-US', { timeZone: tz }))
      const endJak = new Date(end.toLocaleString('en-US', { timeZone: tz }))
      params.date_from = startJak.toISOString()
      params.date_to = endJak.toISOString()
    } else if (range === 'week') {
      const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0)
      const end = new Date()
      const startJak = new Date(start.toLocaleString('en-US', { timeZone: tz }))
      const endJak = new Date(end.toLocaleString('en-US', { timeZone: tz }))
      params.date_from = startJak.toISOString()
      params.date_to = endJak.toISOString()
    } else if (startDate && endDate) {
      const s = new Date(startDate); s.setHours(0, 0, 0, 0)
      const e = new Date(endDate); e.setHours(23, 59, 59, 999)
      const sJak = new Date(s.toLocaleString('en-US', { timeZone: tz }))
      const eJak = new Date(e.toLocaleString('en-US', { timeZone: tz }))
      params.date_from = sJak.toISOString()
      params.date_to = eJak.toISOString()
    }
    if (statusFilter) params.status = statusFilter
    if (selectedChild !== 'all') params.clientId = selectedChild
    return params
  }

  const fetchSummary = async () => {
    if (!clientId) return
    setLoadingSummary(true)
    try {
      const { data } = await api.get<{ balance: number; totalPending: number; children: ClientOption[] }>(
        `/admin/clients/${clientId}/dashboard`,
        { params: buildParams() }
      )
      setBalance(data.balance)
      setTotalPend(data.totalPending)
      setChildren(data.children)
    } catch {
      router.push('/login')
    } finally {
      setLoadingSummary(false)
    }
  }

  const fetchTransactions = async () => {
    if (!clientId) return
    setLoadingTx(true)
    try {
      const { data } = await api.get<{ transactions: Tx[] }>(
        `/admin/clients/${clientId}/dashboard`,
        { params: buildParams() }
      )
      setTxs(data.transactions)
      setTotalTrans(data.transactions.length)
    } catch {
      router.push('/login')
    } finally {
      setLoadingTx(false)
    }
  }

  const reconcileBalance = async () => {
    if (!clientId) return
    try {
      await api.post(`/admin/clients/${clientId}/reconcile-balance`)
      fetchSummary()
    } catch {
      router.push('/login')
    }
  }

  useEffect(() => { fetchSummary() }, [clientId, range, selectedChild, from, to, statusFilter])
  useEffect(() => { fetchTransactions() }, [clientId, range, selectedChild, from, to, statusFilter])
  const filtered = txs.filter(t =>
    (statusFilter === '' || t.status === statusFilter) &&
    (
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      t.rrn.toLowerCase().includes(search.toLowerCase()) ||
      t.playerId.toLowerCase().includes(search.toLowerCase())
    )
  )
  const totalTransaksiCount = filtered.length

  if (loadingSummary) return <div className={styles.loader}>Loading summary…</div>

  return (
    <ClientLayout>
      <div className={styles.container}>
        {children.length > 0 && (
          <div className={styles.childSelector}>
            <label>Pilih Child:&nbsp;</label>
            <select value={selectedChild} onChange={e => setSelectedChild(e.target.value as any)}>
              <option value="all">Semua Child</option>
              {children.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <aside className={styles.sidebar}>
          <section className={styles.statsGrid}>
            <div className={`${styles.card} ${styles.activeBalance}`}>
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
              <p>{balance.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}</p>
              <button className={styles.applyBtn} onClick={reconcileBalance}>Reconcile Balance</button>
            </div>
            <div className={styles.card}>
              <ListChecks className={styles.cardIcon} />
              <h2>Transactions</h2>
              <p>{totalTransaksiCount}</p>
            </div>
            <div className={`${styles.card} ${styles.pendingBalance}`}>
              <Clock className={styles.cardIcon} />
              <h2>Pending Settlement</h2>
              <p>{totalPend.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}</p>
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
                    onChange={upd => setDateRange(upd)}
                    isClearable={false}
                    placeholderText="Select Date Range…"
                    maxDate={new Date()}
                    dateFormat="dd-MM-yyyy"
                    className={styles.dateInput}
                  />
                  {(startDate || endDate) && (
                    <button type="button" className={styles.clearRangeBtn} onClick={() => setDateRange([null, null])}>
                      Clear
                    </button>
                  )}
                  <button type="button" className={styles.applyBtn} onClick={fetchTransactions} disabled={!startDate || !endDate}>
                    Terapkan
                  </button>
                </div>
              )}
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="SUCCESS">SUCCESS</option>
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
                      <th>Update At</th>
                      <th>Settled At</th>
                      <th>TRX ID</th>
                      <th>RRN</th>
                      <th>Player ID</th>
                      <th>Amount</th>
                      <th>Fee</th>
                      <th>Net Amount</th>
                      <th>Status</th>
                      <th>Settlement Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(t => (
                      <tr key={t.id}>
                        <td>{new Date(t.date).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>{t.paymentReceivedTime ? new Date(t.paymentReceivedTime).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                        <td>{t.settlementTime ? new Date(t.settlementTime).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                        <td>
                          <code className="font-mono">{t.id}</code>
                          <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(t.id)} title="Copy TRX ID">
                            <ClipboardCopy size={14} />
                          </button>
                        </td>
                        <td>
                          <div className={styles.rrnCell}>
                            <span className={styles.ellipsis}>{t.rrn}</span>
                            <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(t.rrn)} title="Copy RRN">
                              <ClipboardCopy size={14} />
                            </button>
                          </div>
                        </td>
                        <td>{t.playerId}</td>
                        <td>{t.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}</td>
                        <td>{t.feeLauncx.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}</td>
                        <td className={styles.netSettle}>{t.netSettle.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}</td>
                        <td>
                          {t.status === 'SUCCESS'
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
                              : t.settlementStatus || '-'}
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
    </ClientLayout>
  )
}

(AdminClientDashboard as any).disableLayout = true
export default AdminClientDashboard