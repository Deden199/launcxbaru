'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Wallet, ListChecks, Clock, Layers } from 'lucide-react'
import styles from './Dashboard.module.css'
import dynamic from 'next/dynamic'
import { Tx, Withdrawal, SubBalance } from '@/types/dashboard'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

function parseJwt(t: string) {
  try {
    return JSON.parse(atob(t.split('.')[1]))
  } catch {
    return null
  }
}

function mapWithdrawStatus(
  status: string
): 'PENDING' | 'COMPLETED' | 'FAILED' | undefined {
  const s = status.toUpperCase()
  return ['PENDING', 'COMPLETED', 'FAILED'].includes(s as any)
    ? (s as 'PENDING' | 'COMPLETED' | 'FAILED')
    : undefined
}
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
interface AdminWithdrawal {
  id: string
  bankName: string
  bankCode: string
  accountNumber: string
  accountName: string
  amount: number
  pgRefId?: string | null
  status: string
  createdAt: string
  wallet: string
}

type Merchant = { id: string; name: string }

type TransactionsResponse = {
  transactions: RawTx[]
  total: number
  totalPending: number
  ordersActiveBalance: number
  totalMerchantBalance: number
   totalPaid: number             // ← tambahan

}

const TransactionsTable = dynamic(() => import('@/components/dashboard/TransactionsTable'))
const WithdrawalHistory = dynamic(() => import('@/components/dashboard/WithdrawalHistory'))
const AdminWithdrawForm = dynamic(() => import('@/components/dashboard/AdminWithdrawForm'))

export default function DashboardPage() {
  useRequireAuth()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

    // ─────────── State withdrawal history ───────────
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loadingWd, setLoadingWd] = useState(true)
  // Merchant dropdown
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [selectedMerchant, setSelectedMerchant] = useState<'all' | string>('all')
const [subBalances, setSubBalances] = useState<SubBalance[]>([])
const [selectedSub, setSelectedSub] = useState<string>('')
const [currentBalance, setCurrentBalance] = useState(0)
const [loadingBalances, setLoadingBalances] = useState(true)
const [balanceError, setBalanceError] = useState('')
  const [adminWithdrawals, setAdminWithdrawals] = useState<AdminWithdrawal[]>([])
  const [loadingAdminWd, setLoadingAdminWd] = useState(true)
const [wdAmount, setWdAmount] = useState('')
const [wdAccount, setWdAccount] = useState('')
const [wdBank, setWdBank] = useState('')
const [wdName, setWdName] = useState('')
const [otp, setOtp] = useState('')
const [banks, setBanks] = useState<{ code: string; name: string }[]>([])
const bankOptions = banks.map(b => ({ value: b.code, label: b.name }))
const [isValid, setIsValid] = useState(false)
const [busy, setBusy] = useState({ validating: false, submitting: false })
const [error, setError] = useState('')
  // Filters
  
  const [range, setRange] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [startDate, endDate] = dateRange
    const [from, setFrom]   = useState(() => toJakartaDate(new Date()))
  const [to, setTo]       = useState(() => toJakartaDate(new Date()))
  const [search, setSearch] = useState('')
const [statusFilter, setStatusFilter] = useState<'SUCCESS' | 'PAID' | string>('PAID')
const [withdrawStatusFilter, setWithdrawStatusFilter] = useState('')


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

    useEffect(() => {
    const tok = localStorage.getItem('token')
    if (tok) {
      const payload = parseJwt(tok)
      if (payload?.role === 'SUPER_ADMIN') setIsSuperAdmin(true)
    }
  }, [])

    useEffect(() => {
    api
      .get<{ banks: { code: string; name: string }[] }>('/banks')
      .then(res => setBanks(res.data.banks))
      .catch(console.error)
  }, [])

  // Date helpers
  function toJakartaDate(d: Date): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(d)
  }  const today0  = () => { const d = new Date(); d.setHours(0,0,0,0); return d }
  const week0   = () => { const d = new Date(); d.setDate(d.getDate()-6); d.setHours(0,0,0,0); return d }

function buildParams() {
  const p: any = {}
  const tz = 'Asia/Jakarta'
  if (startDate && endDate) {
    const s = new Date(startDate); s.setHours(0,0,0,0)
    const e = new Date(endDate); e.setHours(23,59,59,999)
    const sJak = new Date(s.toLocaleString('en-US', { timeZone: tz }))
    const eJak = new Date(e.toLocaleString('en-US', { timeZone: tz }))
    p.date_from = sJak.toISOString()
    p.date_to   = eJak.toISOString()
  }
  else if (range === 'today') {
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

    // (2) panggil endpoint summary tanpa balances
    const { data } = await api.get<{
      totalClientBalance: number
      totalPaymentVolume?: number
      totalPaid?: number
      totalSettlement?: number
      totalSuccessfulWithdraw?: number
    }>('/admin/merchants/dashboard/summary', { params })

    if (data.totalClientBalance !== undefined)
      setTotalClientBalance(data.totalClientBalance)
    if (data.totalPaymentVolume !== undefined) setTpv(data.totalPaymentVolume)
    if (data.totalSettlement !== undefined) setTotalSettlement(data.totalSettlement)
    if (data.totalSuccessfulWithdraw !== undefined)
      setSuccessWithdraw(data.totalSuccessfulWithdraw)
    if (data.totalPaid !== undefined) setTotalTrans(data.totalPaid)
  } catch (e) {
    console.error('fetchSummary error', e)
  } finally {
    setLoadingSummary(false)
  }
}

const fetchBalances = async () => {
  setLoadingBalances(true)
  setBalanceError('')
  try {
    const id = selectedMerchant === 'all' ? 'all' : selectedMerchant
    const { data } = await api.get<{
      subBalances: SubBalance[]
      total_withdrawal?: number
      pending_withdrawal?: number
    }>(`/admin/merchants/${id}/balances`)

    setSubBalances(data.subBalances)
    const current =
      data.subBalances.find(s => s.id === selectedSub) || data.subBalances[0]
    if (current) {
      setSelectedSub(current.id)
      setCurrentBalance(current.balance)
    }

    if (
      data.total_withdrawal !== undefined &&
      data.pending_withdrawal !== undefined
    ) {
      setAvailableWithdraw(data.total_withdrawal - data.pending_withdrawal)
      setTotalPending(data.pending_withdrawal)
    }
  } catch (e) {
    console.error('fetchBalances error', e)
    setBalanceError('Failed to load balances. Please try again.')
  } finally {
    setLoadingBalances(false)
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
    delete params.status
    const status = mapWithdrawStatus(withdrawStatusFilter)
    if (status) params.status = status
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
async function fetchAdminWithdrawals() {
  setLoadingAdminWd(true)
  try {
    const params = buildParams()
    delete params.status
    const status = mapWithdrawStatus(withdrawStatusFilter)
    if (status) params.status = status
    const { data } = await api.get<{ data: AdminWithdrawal[] }>(
      '/admin/merchants/dashboard/admin-withdrawals',
      { params }
    )
    setAdminWithdrawals(data.data)
  } catch (err: any) {
    console.error('fetchAdminWithdrawals error', err)
  } finally {
    setLoadingAdminWd(false)
  }
}

async function handleAdminWithdraw(e: React.FormEvent) {
  e.preventDefault()
  if (!isValid || error) return
  setBusy(b => ({ ...b, submitting: true }))
  try {
    await api.post('/admin/merchants/dashboard/withdraw', {
      subMerchantId: selectedSub,
      amount: Number(wdAmount),
      bank_code: wdBank,
      account_number: wdAccount,
      account_name: wdName,
      otp,
    })
    setWdAmount('')
    setWdAccount('')
    setWdBank('')
    setWdName('')
    setOtp('')
    setIsValid(false)

  } catch (err: any) {
    alert(err.response?.data?.error || 'Failed')
     } finally {
    setBusy(b => ({ ...b, submitting: false }))
  }
}

async function validateBankAccount() {
  setBusy(b => ({ ...b, validating: true }))
  setError('')
  try {
    const res = await api.post(
      '/admin/merchants/dashboard/validate-account',
      {
        subMerchantId: selectedSub,
        bank_code: wdBank,
        account_number: wdAccount
      },
      { validateStatus: () => true }
    )
    if (res.status === 200 && res.data.status === 'valid') {
      setWdName(res.data.account_holder)
      setIsValid(true)
    } else {
      setIsValid(false)
      setError(res.data.error || 'Account not valid')
    }
  } catch {
    setIsValid(false)
    setError('Validation failed')
  } finally {
    setBusy(b => ({ ...b, validating: false }))
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
  const handleDateChange = (dates: [Date | null, Date | null]) => {
    setDateRange(dates)
    if (dates[0] && dates[1]) {
      setRange('custom')
      setFrom(toJakartaDate(dates[0]))
      setTo(toJakartaDate(dates[1]))
      setPage(1)
    }
  }
  // Effects
  useEffect(() => {
    fetchSummary()
    fetchProfit()
    fetchProfitSub()
    fetchAdminWithdrawals()

    fetchWithdrawals()
  }, [range, from, to, selectedMerchant, withdrawStatusFilter])
  useEffect(() => {
    fetchBalances()
  }, [selectedMerchant])
  useEffect(() => {
    fetchTransactions()
  }, [range, from, to, selectedMerchant, search, statusFilter, page, perPage])

  if (loadingSummary) {
    return <div className={styles.loader}>Loading summary…</div>
  }

  return (
    <div className={styles.container}>
      {/* Merchant selector & range filter */}
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

        <select
          value={range}
          onChange={e => setRange(e.target.value as typeof range)}
        >
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
                onClick={() => setDateRange([null, null])}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              className={styles.applyBtn}
              onClick={applyDateRange}
              disabled={!startDate || !endDate}
            >
              Terapkan
            </button>
          </div>
        )}
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
  {loadingBalances ? (
    <div className={styles.statsGrid}>
      <div className={`${styles.card} ${styles.cardLoader}`}>Loading balances…</div>
    </div>
  ) : balanceError ? (
    <div className={styles.error}>{balanceError}</div>
  ) : (
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
  )}
</section>

{isSuperAdmin && (
  <AdminWithdrawForm
    subBalances={subBalances}
    selectedSub={selectedSub}
    setSelectedSub={setSelectedSub}
    wdAmount={wdAmount}
    setWdAmount={setWdAmount}
    wdAccount={wdAccount}
    setWdAccount={setWdAccount}
    wdBank={wdBank}
    setWdBank={setWdBank}
    wdName={wdName}
    otp={otp}
    setOtp={setOtp}
    bankOptions={bankOptions}
    isValid={isValid}
    busy={busy}
    error={error}
    validateBankAccount={validateBankAccount}
    handleAdminWithdraw={handleAdminWithdraw}
  />
)}
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
      <section className={styles.withdrawSection}>
        <WithdrawalHistory loadingWd={loadingWd} withdrawals={withdrawals} />
      </section>
            {/* === ADMIN WITHDRAWAL HISTORY ======================================= */}
      {isSuperAdmin && (
        <section className={styles.tableSection} style={{ marginTop: 32 }}>
          <h2>Admin Withdrawals</h2>
          {loadingAdminWd ? (
            <div className={styles.loader}>Loading withdrawals…</div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Wallet</th>
                    <th>Bank</th>
                    <th>Account No.</th>
                    <th>Account Name</th>
                    <th>Amount</th>
                    <th>PG Ref ID</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {adminWithdrawals.length ? (
                    adminWithdrawals.map(a => (
                      <tr key={a.id}>
                        <td>
                          {new Date(a.createdAt).toLocaleString('id-ID', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td>{a.wallet}</td>
                        <td>{a.bankName}</td>
                        <td>{a.accountNumber}</td>
                        <td>{a.accountName}</td>
                        <td>
                          {a.amount.toLocaleString('id-ID', {
                            style: 'currency',
                            currency: 'IDR',
                          })}
                        </td>
                        <td>{a.pgRefId ?? '-'}</td>
                        <td>{a.status}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className={styles.noData}>
                        No withdrawals
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      </main>
    </div>
  )
}
