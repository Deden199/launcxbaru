'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Wallet, ListChecks, Clock, FileText, ClipboardCopy, Layers } from 'lucide-react'
import styles from './Dashboard.module.css'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
type RawTx = {
  id: string
  date: string
  playerId: string
  rrn?: string
  reference?: string
  amount?: number
  feeLauncx?: number
  feePg?: number
  pendingAmount?: number
  settlementAmount?: number
  status?: string
  settlementStatus: string
  netSettle:        number   // <— baru
  channel?:     string   // ← baru
  paymentReceivedTime?: string
  settlementTime?: string
  trxExpirationTime?: string


}
interface Withdrawal {
  id: string
  refId: string
  accountName: string
  accountNameAlias: string
  accountNumber: string
  bankCode: string
  bankName: string
  branchName?: string
  amount: number
  withdrawFeePercent: number
  withdrawFeeFlat: number
  pgFee?: number

  netAmount?: number
  paymentGatewayId?: string
  isTransferProcess: boolean
  status: string
  createdAt: string
  completedAt?: string
  wallet: string

}

type Tx = {
  id: string
  date: string
  rrn: string
  playerId: string
  amount: number
  feeLauncx: number
  feePg: number
  netSettle: number
  status: '' | 'SUCCESS' | 'PENDING' | 'EXPIRED' | 'DONE' | 'PAID'
  settlementStatus: string
  channel:          string  // ← baru
    paymentReceivedTime?: string
  settlementTime?: string
  trxExpirationTime?: string

}

type Merchant = { id: string; name: string }
type SubBalance = { id: string; name: string; provider: string; balance: number }

type TransactionsResponse = {
  transactions: RawTx[]
  total: number
  totalPending: number
  ordersActiveBalance: number
  totalMerchantBalance: number
   totalPaid: number             // ← tambahan

}

export default function DashboardPage() {
  useRequireAuth()

    // ─────────── State withdrawal history ───────────
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loadingWd, setLoadingWd] = useState(true)
  // Merchant dropdown
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [selectedMerchant, setSelectedMerchant] = useState<'all' | string>('all')
const [subBalances, setSubBalances] = useState<SubBalance[]>([])
const [selectedSub, setSelectedSub] = useState<string>('')
const [currentBalance, setCurrentBalance] = useState(0)
  // Filters
  
  const [range, setRange] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [startDate, endDate] = dateRange
    const [from, setFrom]   = useState(() => toJakartaDate(new Date()))
  const [to, setTo]       = useState(() => toJakartaDate(new Date()))
  const [search, setSearch] = useState('')
const [statusFilter, setStatusFilter] = useState<'SUCCESS' | 'PAID' | string>('PAID')


  const [totalPages, setTotalPages] = useState(1)

  // Summary cards state
  const [loadingSummary, setLoadingSummary] = useState(true)
 const [totalClientBalance, setTotalClientBalance] = useState(0)
  const [tpv, setTpv]                         = useState(0)
  const [totalSettlement, setTotalSettlement] = useState(0)
  const [availableWithdraw, setAvailableWithdraw] = useState(0)
  const [successWithdraw, setSuccessWithdraw] = useState(0)
  const [activeBalance, setActiveBalance]     = useState(0)
  const [totalPending, setTotalPending]       = useState(0)
  const [loadingProfit, setLoadingProfit]     = useState(true)
  const [totalProfit, setTotalProfit]         = useState(0)
  const [loadingProfitSub, setLoadingProfitSub] = useState(true)
  const [profitSubs, setProfitSubs] = useState<{
    subMerchantId: string
    name?: string | null
    profit: number
  }[]>([])
  // Transactions table state
  const [loadingTx, setLoadingTx] = useState(true)
  const [txs, setTxs]             = useState<Tx[]>([])
  const [totalTrans, setTotalTrans] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  // Date helpers
  function toJakartaDate(d: Date): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(d)
  }  const today0  = () => { const d = new Date(); d.setHours(0,0,0,0); return d }
  const week0   = () => { const d = new Date(); d.setDate(d.getDate()-6); d.setHours(0,0,0,0); return d }

function buildParams() {
  const p: any = {}
  const tz = 'Asia/Jakarta'

  if (range === 'today') {
    // jam 00:00:00 di Jakarta
    const startStr = new Date().toLocaleString('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
    // parse ulang ke Date lalu set ke 00:00:00
    const [m, d, y, H, M, S] = startStr.match(/\d+/g)!.map(Number)
    const start = new Date(y, m-1, d, 0, 0, 0)
    // sekarang waktu Jakarta
    const nowStr = new Date().toLocaleString('en-US', { timeZone: tz, hour12: false })
    const now = new Date(nowStr)

    p.date_from = start.toISOString()
    p.date_to   = now.toISOString()
  }
    else if (range === 'yesterday') {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0)
    const startJak = new Date(d.toLocaleString('en-US', { timeZone: tz }))
    const endJak = new Date(new Date(d.getTime()+86399999).toLocaleString('en-US', { timeZone: tz }))

    p.date_from = startJak.toISOString()
    p.date_to   = endJak.toISOString()
  }
  else if (range === 'week') {
    // 7 hari lalu 00:00 Jakarta
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 6)
    const weekStr = weekAgo.toLocaleString('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit'
    })
    const [m, d, y] = weekStr.match(/\d+/g)!.slice(0,3).map(Number)
    const start = new Date(y, m-1, d, 0, 0, 0)
    // sampai sekarang Jakarta
    const nowStr = new Date().toLocaleString('en-US', { timeZone: tz, hour12: false })
    const now = new Date(nowStr)

    p.date_from = start.toISOString()
    p.date_to   = now.toISOString()
  }
  else if (range === 'month') {
    const start = new Date(); start.setDate(start.getDate() - 29); start.setHours(0,0,0,0)
    const end   = new Date()
    const startJak = new Date(start.toLocaleString('en-US', { timeZone: tz }))
    const endJak   = new Date(end.toLocaleString('en-US', { timeZone: tz }))
    p.date_from = startJak.toISOString()
    p.date_to   = endJak.toISOString()
  }
  else if (startDate && endDate) {
    const s = new Date(startDate); s.setHours(0,0,0,0)
    const e = new Date(endDate); e.setHours(23,59,59,999)
    const sJak = new Date(s.toLocaleString('en-US', { timeZone: tz }))
    const eJak = new Date(e.toLocaleString('en-US', { timeZone: tz }))
    p.date_from = sJak.toISOString()
    p.date_to   = eJak.toISOString()
  }

  if (selectedMerchant !== 'all') {
    p.partnerClientId = selectedMerchant
  }
    if (statusFilter !== 'all') {
    p.status = statusFilter
  }
  if (search.trim()) {
    p.search = search.trim()
  }
  p.page  = page
    p.limit = perPage
  console.log('buildParams →', p)
  return p
}


  // Fetch Hilogate summary
const fetchSummary = async () => {
  setLoadingSummary(true)
  try {
    const params = buildParams()

    // (1) ambil list merchants sekali saja
    if (!merchants.length) {
      const resp = await api.get<Merchant[]>('/admin/merchants/allclient')
      setMerchants(resp.data)
    }

    // (2) panggil endpoint summary, termasuk oyBalance
    const { data } = await api.get<{
      subBalances:        SubBalance[]
      activeBalance?:     number
      totalClientBalance: number
      totalPaymentVolume?: number
      totalPaid?: number
      totalSettlement?: number
      totalAvailableWithdraw?: number
      totalSuccessfulWithdraw?: number
      total_withdrawal?:  number
      pending_withdrawal?:number
    }>('/admin/merchants/dashboard/summary', { params })

    // (3) set state untuk semua balance
    setSubBalances(data.subBalances)
    const current = data.subBalances.find(s => s.id === selectedSub) || data.subBalances[0]
    if (current) {
      setSelectedSub(current.id)
      setCurrentBalance(current.balance)
    }
if (data.totalClientBalance !== undefined) setTotalClientBalance(data.totalClientBalance)  // ← Tambahkan ini
    if (data.pending_withdrawal  !== undefined) setTotalPending(data.pending_withdrawal)
    if (data.totalPaymentVolume   !== undefined) setTpv(data.totalPaymentVolume)
    if (data.totalSettlement      !== undefined) setTotalSettlement(data.totalSettlement)
    if (data.totalAvailableWithdraw !== undefined) setAvailableWithdraw(data.totalAvailableWithdraw)
    if (data.totalSuccessfulWithdraw !== undefined) setSuccessWithdraw(data.totalSuccessfulWithdraw)
    if (data.totalPaid !== undefined) setTotalTrans(data.totalPaid)
  } catch (e) {
    console.error('fetchSummary error', e)
  } finally {
    setLoadingSummary(false)
  }
}

  const fetchProfitSub = async () => {
    setLoadingProfitSub(true)
    try {
      const params = buildParams()
      const { data } = await api.get<{ data: { subMerchantId: string; name?: string | null; profit: number }[] }>(
        '/admin/merchants/dashboard/profit-submerchant',
        { params }
      )
      setProfitSubs(data.data)
    } catch (e) {
      console.error('fetchProfitSub error', e)
    } finally {
      setLoadingProfitSub(false)
    }
  }
  // Fetch platform profit
  const fetchProfit = async () => {
    setLoadingProfit(true)
    try {
      const params = buildParams()
      const { data } = await api.get<{ totalProfit: number }>(
        '/admin/merchants/dashboard/profit',
        { params }
      )
      setTotalProfit(data.totalProfit)
    } catch (e) {
      console.error('fetchProfit error', e)
    } finally {
      setLoadingProfit(false)
    }
  }
async function fetchWithdrawals() {
  setLoadingWd(true)
  try {
    const params = buildParams()
    const { data } = await api.get<{ data: Withdrawal[] }>(
      '/admin/merchants/dashboard/withdrawals',
      { params }
    )
    setWithdrawals(data.data)
  } catch (err: any) {
    console.error('fetchWithdrawals error', err)
    if (err.response?.status === 401) {
    }
  } finally {
    setLoadingWd(false)
  }
}


  // Fetch transactions list
  const fetchTransactions = async () => {
    setLoadingTx(true)
    try {
      const params = buildParams()
      const { data } = await api.get<TransactionsResponse>(
        '/admin/merchants/dashboard/transactions',
        { params }
      )


          setTotalPending(data.totalPending)
    setActiveBalance(data.ordersActiveBalance)
    setTotalPages(Math.max(1, Math.ceil(data.total / perPage)))
    // pakai totalPaid dari API:
    setTotalTrans(data.totalPaid)
      // LANGSUNG PAKAI netSettle dari server
// Daftar status yang valid sesuai Tx['status']
const VALID_STATUSES: Tx['status'][] = [
  'SUCCESS',
  'PENDING',
  'EXPIRED',
  'DONE',
  'PAID',
];

const mapped: Tx[] = data.transactions.map(o => {
  const raw = o.status ?? '';

  // Jika status dari server cocok dengan salah satu VALID_STATUSES, pakai itu,
  // jika tidak, fallback ke '' (kosong)
  const statusTyped: Tx['status'] = VALID_STATUSES.includes(raw as Tx['status'])
    ? (raw as Tx['status'])
    : '';

  return {
    id:                 o.id,
    date:               o.date,
    rrn:                o.rrn ?? '-',
    playerId:           o.playerId,
    amount:             o.amount ?? 0,
    feeLauncx:          o.feeLauncx ?? 0,
    feePg:              o.feePg ?? 0,
    netSettle:          o.netSettle,
    status:             statusTyped,                                // <<< revisi
    settlementStatus:   o.settlementStatus.replace(/_/g, ' '),
    paymentReceivedTime: o.paymentReceivedTime ?? '',
    settlementTime:     o.settlementTime ?? '',
    trxExpirationTime:  o.trxExpirationTime ?? '',
    channel:            o.channel ?? '-',
  };
});

const filtered = mapped.filter(t => {
 
  // (2) Kalau search kosong, tampilkan semua yang lolos status
  const q = search.trim().toLowerCase();
    if (!q) return true;

  // (3) Baru cek keyword di id, rrn, atau playerId
  return (
    t.id.toLowerCase().includes(q) ||
    t.rrn.toLowerCase().includes(q) ||
    t.playerId.toLowerCase().includes(q)
  );
});


   setTxs(filtered)

    } catch (e) {
      console.error('fetchTransactions error', e)
    } finally {
      setLoadingTx(false)
    }
  }
  const applyDateRange = () => {
    if (startDate && endDate) {
      setFrom(toJakartaDate(startDate))
      setTo(toJakartaDate(endDate))
    }
  }
  // Effects
  useEffect(() => {
    fetchSummary()
    fetchProfit()
    fetchProfitSub()

    fetchWithdrawals()
  }, [range, from, to, selectedMerchant])
  useEffect(() => {
    fetchTransactions()
  }, [range, from, to, selectedMerchant, search, statusFilter, page, perPage])

  if (loadingSummary) {
    return <div className={styles.loader}>Loading summary…</div>
  }

  return (
    <div className={styles.container}>
      {/* Merchant selector */}
      <div className={styles.childSelector}>
        <label>Client:</label>
        <select
          value={selectedMerchant}
          onChange={e => setSelectedMerchant(e.target.value)}
        >
          <option value="all">Semua Client</option>
          {merchants.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
                  <div className={styles.rangeControls}>
            <select value={range} onChange={e => setRange(e.target.value as any)}>
              <option value="today">Hari ini</option>
              <option value="yesterday">Kemarin</option>

              <option value="week">7 Hari Terakhir</option>
              <option value="month">30 Hari Terakhir</option>

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
                  <button
                    type="button"
                    className={styles.clearRangeBtn}
                    onClick={() => {
                      setDateRange([null, null])
                      setFrom(toJakartaDate(new Date()))
                      setTo(toJakartaDate(new Date()))
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className={styles.applyBtn}
                  onClick={() => {
                    applyDateRange()
                    fetchSummary()
                    fetchProfit()
                    fetchProfitSub()
                    fetchWithdrawals()
                    fetchTransactions()
                  }}
                  disabled={!startDate || !endDate}
                >
                  Terapkan
                </button>
              </div>
            )}
          </div>
      </div>
<aside className={styles.sidebar}>
  <section className={styles.statsGrid}>
 
    <div className={`${styles.card} ${styles.pendingBalance}`}>
      <div className={styles.iconWrapper}>
        <Layers size={48} />
      </div>
      <h3 className={styles.cardTitle}>TPV</h3>
      <p className={styles.cardValue}>
        {tpv.toLocaleString("id-ID", { style: "currency", currency: "IDR" })}
      </p>
    </div>

    <div className={`${styles.card} ${styles.pendingBalance}`}>
      <div className={styles.iconWrapper}>
        <ListChecks size={48} />
      </div>
      <h3 className={styles.cardTitle}>Total Paid</h3>
      <p className={styles.cardValue}>
        {totalTrans.toLocaleString("id-ID", { style: "currency", currency: "IDR" })}
      </p>
    </div>

    <div className={`${styles.card} ${styles.pendingBalance}`}>
      <div className={styles.iconWrapper}>
        <Clock size={48} />
      </div>
      <h3 className={styles.cardTitle}>Total Settlement</h3>
      <p className={styles.cardValue}>
        {totalSettlement.toLocaleString("id-ID", { style: "currency", currency: "IDR" })}
      </p>
    </div>

       <div className={`${styles.card} ${styles.activeBalance}`}>
      <div className={styles.iconWrapper}>
        <Wallet size={48} />
      </div>
      <h3 className={styles.cardTitle}>Available Client Withdraw</h3>
      <p className={styles.cardValue}>
        {totalClientBalance.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
      </p>
    </div>

    <div className={`${styles.card} ${styles.pendingBalance}`}>
      <div className={styles.iconWrapper}>
        <Wallet size={48} />
      </div>
      <h3 className={styles.cardTitle}>Successful Withdraw</h3>
      <p className={styles.cardValue}>
        {successWithdraw.toLocaleString("id-ID", { style: "currency", currency: "IDR" })}
      </p>
    </div>
  </section>
</aside>

<section className={styles.cardSection} style={{ marginTop: 32 }}>
  <h2>Wallet Balances</h2>
  <div className={styles.statsGrid}>
    {subBalances.map(s => (
      <div key={s.id} className={`${styles.card} ${styles.activeBalance}`}>
        <h3 className={styles.cardTitle}>{s.name}</h3>
        <p className={styles.cardValue}>
          {s.balance.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
        </p>
      </div>
    ))}
  </div>
</section>
<section className={styles.cardSection} style={{ marginTop: 32 }}>
  <h2>Profit per sub</h2>
  {loadingProfitSub ? (
    <div className={styles.loader}>Loading profit…</div>
  ) : (
    <div className={styles.statsGrid}>
      {profitSubs.length > 0 ? (
        profitSubs.map(p => (
          <div
            key={p.subMerchantId}
            className={`${styles.card} ${styles.activeBalance}`}
          >
            <h3 className={styles.cardTitle}>
              {p.name ?? p.subMerchantId}
            </h3>
            <p className={styles.cardValue}>
              {p.profit.toLocaleString('id-ID', {
                style: 'currency',
                currency: 'IDR'
              })}
            </p>
          </div>
        ))
      ) : (
        // render card kosong kalau tidak ada data
        <div className={`${styles.card} ${styles.noDataCard}`}>
          <h3 className={styles.cardTitle}>No data</h3>
          <p className={styles.cardValue}>–</p>
        </div>
      )}
    </div>
  )}
</section>
      {/* Filters & Table */}
      <main className={styles.content}>
        <section className={styles.filters}>
          <div className={styles.rangeControls}>
            <select value={range} onChange={e => setRange(e.target.value as any)}>
              <option value="today">Hari ini</option>
              <option value="yesterday">Kemarin</option>

              <option value="week">7 Hari Terakhir</option>

              <option value="month">30 Hari Terakhir</option>

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
                  <button
                    type="button"
                    className={styles.clearRangeBtn}
                    onClick={() => {
                      setDateRange([null, null])
                      setFrom(toJakartaDate(new Date()))
                      setTo(toJakartaDate(new Date()))
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className={styles.applyBtn}
                  onClick={() => {
                    applyDateRange()
                    fetchSummary()
                    fetchProfit()
                    fetchProfitSub()
                    fetchWithdrawals()
                    fetchTransactions()
                  }}
                  disabled={!startDate || !endDate}
                >
                  Terapkan
                </button>
              </div>
            )}
          </div>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Cari TRX ID, RRN, atau Player ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
<select
  value={statusFilter}
  onChange={e => setStatusFilter(e.target.value)}
>
  <option value="all">All Status</option>
  <option value="SUCCESS">SUCCESS</option>
  <option value="PAID">PAID</option>
  <option value="PENDING">PENDING</option>
  <option value="EXPIRED">EXPIRED</option>
</select>

          <button
            onClick={() => {
              api.get('/admin/merchants/dashboard/export-all', {
                params: buildParams(),
                responseType: 'blob'
    }).then(r => {
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
                    <th>Paid At</th>           {/* baru */}
                    <th>Settled At</th>        {/* baru */}
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
                                      ? new Date(t.paymentReceivedTime)
                                              .toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' })
                                           : '-'}
                                             </td>
                        <td>
                       {t.settlementTime
                         ? new Date(t.settlementTime)
                        .toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' })
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
                      <td>{t.channel}</td>            {/* ← baru */}
                      <td>{t.amount.toLocaleString('id-ID', { style:'currency', currency:'IDR' })}</td>
                      <td>{t.feeLauncx.toLocaleString('id-ID', { style:'currency', currency:'IDR' })}</td>
                      <td>{t.feePg.toLocaleString('id-ID', { style:'currency', currency:'IDR' })}</td>
                      <td className={styles.netSettle}>{t.netSettle.toLocaleString('id-ID', { style:'currency', currency:'IDR' })}</td>
<td>
  {t.status || '-'}
</td>


<td>
  {t.settlementStatus === 'WAITING'
    ? 'PENDING'
    : t.settlementStatus === 'UNSUCCESSFUL'
      ? 'FAILED'
      : (t.settlementStatus || '-')}
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



   {/* === WITHDRAWAL HISTORY ===================================================== */}
      <section className={styles.tableSection} style={{ marginTop: 32 }}>
        <h2>Withdrawal History</h2>
        {loadingWd ? (
          <div className={styles.loader}>Loading withdrawals…</div>
        ) : (
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
        )}
      </section>
      </main>
    </div>
  )
}
