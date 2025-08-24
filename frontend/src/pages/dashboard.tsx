'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Wallet, ListChecks, Clock, Layers } from 'lucide-react'
import dynamic from 'next/dynamic'
import { Tx, Withdrawal, SubBalance } from '@/types/dashboard'
import { Granularity, buildVolumeSeriesParams } from '@/utils/dashboard'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from 'recharts'

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
  netSettle: number
  channel?: string
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
  totalPaid: number
}

// Dynamic chunks
const TransactionsTable = dynamic(() => import('@/components/dashboard/TransactionsTable'))
const WithdrawalHistory = dynamic(() => import('@/components/dashboard/WithdrawalHistory'))
const AdminWithdrawForm = dynamic(() => import('@/components/dashboard/AdminWithdrawForm'))

// ——— Time utils (WIB) ———
const TZ = 'Asia/Jakarta'
const fmtISODateJak = (d: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d) // yyyy-mm-dd

function startOfDayJak(d: Date) {
  const local = new Date(d)
  local.setHours(0, 0, 0, 0)
  return new Date(local.toLocaleString('en-US', { timeZone: TZ }))
}
function endOfDayJak(d: Date) {
  const local = new Date(d)
  local.setHours(23, 59, 59, 999)
  return new Date(local.toLocaleString('en-US', { timeZone: TZ }))
}
function nowJak() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
}
function getPresetBounds(range: 'today' | 'yesterday' | 'week' | 'month') {
  if (range === 'today') {
    return { start: startOfDayJak(new Date()), end: nowJak() }
  }
  if (range === 'yesterday') {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    return { start: startOfDayJak(y), end: endOfDayJak(y) }
  }
  if (range === 'week') {
    const s = new Date()
    s.setDate(s.getDate() - 6)
    return { start: startOfDayJak(s), end: nowJak() }
  }
  const s = new Date()
  s.setDate(s.getDate() - 29)
  return { start: startOfDayJak(s), end: nowJak() }
}

// === Granularity & bucketing ===
function isSameJakDay(a: Date, b: Date) {
  const aj = new Date(a.toLocaleString('en-US', { timeZone: TZ }))
  const bj = new Date(b.toLocaleString('en-US', { timeZone: TZ }))
  return aj.getFullYear() === bj.getFullYear() &&
    aj.getMonth() === bj.getMonth() &&
    aj.getDate() === bj.getDate()
}
function getGranularity(
  range: 'today' | 'yesterday' | 'week' | 'month' | 'custom',
  startDate: Date | null,
  endDate: Date | null
): Granularity {
  if (range === 'today' || range === 'yesterday') return 'hour'
  if (range === 'custom' && startDate && endDate && isSameJakDay(startDate, endDate)) return 'hour'
  return 'day'
}

export default function DashboardPage() {
  useRequireAuth()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // ── Withdrawal history state ──
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
  const [from, setFrom] = useState(() => fmtISODateJak(new Date()))
  const [to, setTo] = useState(() => fmtISODateJak(new Date()))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [withdrawStatusFilter, setWithdrawStatusFilter] = useState('')

  const [totalPages, setTotalPages] = useState(1)

  // Summary cards state
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [totalClientBalance, setTotalClientBalance] = useState(0)
  const [tpv, setTpv] = useState(0)
  const [totalSettlement, setTotalSettlement] = useState(0)
  const [availableWithdraw, setAvailableWithdraw] = useState(0)
  const [successWithdraw, setSuccessWithdraw] = useState(0)
  const [activeBalance, setActiveBalance] = useState(0)
  const [totalPending, setTotalPending] = useState(0)
  const [loadingProfit, setLoadingProfit] = useState(true)
  const [totalProfit, setTotalProfit] = useState(0)
  const [loadingProfitSub, setLoadingProfitSub] = useState(true)
  const [profitSubs, setProfitSubs] = useState<{ subMerchantId: string; name?: string | null; profit: number }[]>([])

  // Transactions table state
  const [loadingTx, setLoadingTx] = useState(true)
  const [loadingVolume, setLoadingVolume] = useState(true)
  const [txs, setTxs] = useState<Tx[]>([])
  const [volumeSeries, setVolumeSeries] = useState<{ key: string; label: string; amount: number; count: number }[]>([])
  const [totalTrans, setTotalTrans] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Chart bounds & granularity (WIB)
  const { chartStart, chartEnd, granularity } = useMemo(() => {
    if (range === 'custom' && startDate && endDate) {
      const s = startOfDayJak(startDate)
      const e = endOfDayJak(endDate)
      return { chartStart: s, chartEnd: e, granularity: getGranularity(range, startDate, endDate) }
    }
    const { start, end } = getPresetBounds(range as 'today' | 'yesterday' | 'week' | 'month')
    return { chartStart: start, chartEnd: end, granularity: getGranularity(range, null, null) }
  }, [range, startDate, endDate])

  const topProfit = useMemo(() => {
    return [...profitSubs]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 6)
      .map(p => ({ name: p.name || p.subMerchantId, value: p.profit }))
  }, [profitSubs])

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

  function buildParams() {
    const p: any = {}
    if (startDate && endDate) {
      p.date_from = startOfDayJak(startDate).toISOString()
      p.date_to = endOfDayJak(endDate).toISOString()
    } else {
      const { start, end } = getPresetBounds(range as 'today' | 'yesterday' | 'week' | 'month')
      p.date_from = start.toISOString()
      p.date_to = end.toISOString()
    }
    if (selectedMerchant !== 'all') p.partnerClientId = selectedMerchant
    if (statusFilter !== 'all') p.status = statusFilter
    if (search.trim()) p.search = search.trim()
    p.page = page
    p.limit = perPage
    return p
  }

  // Fetchers
  const fetchSummary = async () => {
    setLoadingSummary(true)
    try {
      const params = buildParams()

      if (!merchants.length) {
        const resp = await api.get<Merchant[]>('/admin/merchants/allclient')
        setMerchants(resp.data)
      }

      const { data } = await api.get<{
        totalClientBalance: number
        totalPaymentVolume?: number
        totalPaid?: number
        totalSettlement?: number
        totalSuccessfulWithdraw?: number
      }>('/admin/merchants/dashboard/summary', { params })

      if (data.totalClientBalance !== undefined) setTotalClientBalance(data.totalClientBalance)
      if (data.totalPaymentVolume !== undefined) setTpv(data.totalPaymentVolume)
      if (data.totalSettlement !== undefined) setTotalSettlement(data.totalSettlement)
      if (data.totalSuccessfulWithdraw !== undefined) setSuccessWithdraw(data.totalSuccessfulWithdraw)
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
      const current = data.subBalances.find(s => s.id === selectedSub) || data.subBalances[0]
      if (current) {
        setSelectedSub(current.id)
        setCurrentBalance(current.balance)
      }

      if (data.total_withdrawal !== undefined && data.pending_withdrawal !== undefined) {
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
          account_number: wdAccount,
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
      setTotalTrans(data.totalPaid)

      const VALID_STATUSES: Tx['status'][] = ['SUCCESS', 'PENDING', 'EXPIRED', 'DONE', 'PAID']

      const mapped: Tx[] = data.transactions.map(o => {
        const raw = o.status ?? ''
        const statusTyped: Tx['status'] = VALID_STATUSES.includes(raw as Tx['status'])
          ? (raw as Tx['status'])
          : ''
        return {
          id: o.id,
          date: o.paymentReceivedTime || o.date,
          rrn: o.rrn ?? '-',
          playerId: o.playerId,
          amount: o.amount ?? 0,
          feeLauncx: o.feeLauncx ?? 0,
          feePg: o.feePg ?? 0,
          netSettle: o.netSettle,
          status: statusTyped,
          settlementStatus: o.settlementStatus.replace(/_/g, ' '),
          paymentReceivedTime: o.paymentReceivedTime ?? '',
          settlementTime: o.settlementTime ?? '',
          trxExpirationTime: o.trxExpirationTime ?? '',
          channel: o.channel ?? '-',
        }
      })

      const q = search.trim().toLowerCase()
      const filtered = q
        ? mapped.filter(t =>
            t.id.toLowerCase().includes(q) ||
            t.rrn.toLowerCase().includes(q) ||
            t.playerId.toLowerCase().includes(q)
          )
        : mapped

      setTxs(filtered)
    } catch (e) {
      console.error('fetchTransactions error', e)
    } finally {
      setLoadingTx(false)
    }
  }

  const fetchVolumeSeries = async () => {
    setLoadingVolume(true)
    try {
      const params = buildVolumeSeriesParams(buildParams(), granularity)
      const { data } = await api.get<{ buckets: { bucket: string; totalAmount: number; count: number }[] }>(
        '/admin/merchants/dashboard/volume',
        { params }
      )

      // Map API buckets by timestamp key for quick lookup
      const mapped = Array.isArray(data?.buckets)
        ? data.buckets.map(b => {
            const dtJak = new Date(new Date(b.bucket).toLocaleString('en-US', { timeZone: TZ }))
            if (granularity === 'hour') {
              const dayKey = fmtISODateJak(dtJak)
              const h = String(dtJak.getHours()).padStart(2, '0')
              return { key: `${dayKey} ${h}`, label: `${h}:00`, amount: b.totalAmount, count: b.count }
            }
            const key = fmtISODateJak(dtJak)
            const [y, m, d] = key.split('-')
            return { key, label: `${d}/${m}`, amount: b.totalAmount, count: b.count }
          })
        : []

      const bucketMap = new Map(mapped.map(m => [m.key, { amount: m.amount, count: m.count }]))

      // Build full timestamp series from chartStart to chartEnd
      const series: { key: string; label: string; amount: number; count: number }[] = []
      const cursor = new Date(chartStart)
      while (cursor <= chartEnd) {
        const dtJak = new Date(cursor.toLocaleString('en-US', { timeZone: TZ }))
        if (granularity === 'hour') {
          const dayKey = fmtISODateJak(dtJak)
          const h = String(dtJak.getHours()).padStart(2, '0')
          const key = `${dayKey} ${h}`
          const existing = bucketMap.get(key) || { amount: 0, count: 0 }
          series.push({ key, label: `${h}:00`, amount: existing.amount, count: existing.count })
          cursor.setHours(cursor.getHours() + 1)
        } else {
          const key = fmtISODateJak(dtJak)
          const [y, m, d] = key.split('-')
          const existing = bucketMap.get(key) || { amount: 0, count: 0 }
          series.push({ key, label: `${d}/${m}`, amount: existing.amount, count: existing.count })
          cursor.setDate(cursor.getDate() + 1)
        }
      }

      setVolumeSeries(series)
    } catch (e) {
      console.error('fetchVolumeSeries error', e)
    } finally {
      setLoadingVolume(false)
    }
  }

  const applyDateRange = () => {
    if (startDate && endDate) {
      setFrom(fmtISODateJak(startDate))
      setTo(fmtISODateJak(endDate))
      setPage(1)
    }
  }

  const handleDateChange = (dates: [Date | null, Date | null]) => {
    setDateRange(dates)
    if (dates[0] && dates[1]) {
      setRange('custom')
      setFrom(fmtISODateJak(dates[0]))
      setTo(fmtISODateJak(dates[1]))
      setPage(1)
    }
  }

  useEffect(() => {
    fetchSummary()
    fetchProfit()
    fetchProfitSub()
    fetchAdminWithdrawals()
    fetchWithdrawals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, from, to, selectedMerchant, withdrawStatusFilter])

  useEffect(() => {
    fetchBalances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMerchant])

  useEffect(() => {
    fetchTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, from, to, selectedMerchant, search, statusFilter, page, perPage])

  useEffect(() => {
    fetchVolumeSeries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, from, to, selectedMerchant, search, granularity])

  if (loadingSummary) {
    return (
      <div className="min-h-[60vh] grid place-items-center bg-neutral-950 text-neutral-100">
        <div className="flex items-center gap-3 text-neutral-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-sm font-medium">Loading summary…</span>
        </div>
      </div>
    )
  }

  const volumeTitle = (() => {
    if (granularity === 'hour') {
      let day: Date
      if (range === 'today') {
        day = nowJak()
      } else if (range === 'yesterday') {
        day = getPresetBounds('yesterday').start
      } else {
        day = startDate || nowJak()
      }
      return `Payment Volume (${day.toLocaleDateString('id-ID', { timeZone: TZ })} • per jam)`
    }
    if (range === 'custom' && startDate && endDate) {
      return `Payment Volume (${startDate.toLocaleDateString('id-ID', { timeZone: TZ })} – ${endDate.toLocaleDateString('id-ID', { timeZone: TZ })})`
    }
    const map: Record<typeof range, string> = {
      today: 'Payment Volume (Hari ini)',
      yesterday: 'Payment Volume (Kemarin)',
      week: 'Payment Volume (7 hari)',
      month: 'Payment Volume (30 hari)',
      custom: 'Payment Volume'
    }
    return map[range]
  })()

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6 bg-neutral-950 text-neutral-100">
      {/* Top controls */}
      <div className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/70 backdrop-blur p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Merchant Dashboard</h1>
            <p className="text-sm text-neutral-400">Monitor transaksi, saldo, dan penarikan dalam satu tempat.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
            {/* Client selector */}
            <label className="sm:col-span-1">
              <span className="block text-xs font-medium text-neutral-400 mb-1">Client</span>
              <select
                value={selectedMerchant}
                onChange={e => { setSelectedMerchant(e.target.value); setPage(1) }}
                className="w-full h-10 rounded-xl border border-neutral-800 px-3 text-sm bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-indigo-800"
              >
                <option value="all">Semua Client</option>
                {merchants.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>

            {/* Range selector */}
            <label className="sm:col-span-1">
              <span className="block text-xs font-medium text-neutral-400 mb-1">Rentang Waktu</span>
              <select
                value={range}
                onChange={e => { setRange(e.target.value as typeof range); setDateRange([null, null]); setPage(1) }}
                className="w-full h-10 rounded-xl border border-neutral-800 px-3 text-sm bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-indigo-800"
              >
                <option value="today">Hari ini</option>
                <option value="yesterday">Kemarin</option>
                <option value="week">7 Hari Terakhir</option>
                <option value="month">30 Hari Terakhir</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            {/* Custom range picker */}
            {range === 'custom' && (
              <div className="sm:col-span-1">
                <span className="block text-xs font-medium text-neutral-400 mb-1">Pilih Tanggal</span>
                <div className="flex items-center gap-2">
                  <DatePicker
                    selectsRange
                    startDate={startDate}
                    endDate={endDate}
                    onChange={(upd: any) => handleDateChange(upd)}
                    isClearable={false}
                    placeholderText="Select Date Range…"
                    maxDate={new Date()}
                    dateFormat="dd-MM-yyyy"
                    className="w-full h-10 rounded-xl border border-neutral-800 px-3 text-sm bg-neutral-950 focus:outline-none"
                  />
                  {(startDate || endDate) && (
                    <button
                      type="button"
                      className="h-10 px-3 rounded-xl border border-neutral-800 text-xs font-medium hover:bg-neutral-800"
                      onClick={() => { setDateRange([null, null]); setFrom(fmtISODateJak(new Date())); setTo(fmtISODateJak(new Date())); }}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={applyDateRange}
                    disabled={!startDate || !endDate}
                    className="h-10 px-4 rounded-xl bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow hover:bg-indigo-600"
                  >
                    Terapkan
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <section className="grid gap-4 sm:gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard accent="from-indigo-500 to-violet-500" icon={<Layers className="h-5 w-5" />} title="TPV" value={tpv} />
        <KpiCard accent="from-sky-500 to-cyan-500" icon={<ListChecks className="h-5 w-5" />} title="Total Paid" value={totalTrans} />
        <KpiCard accent="from-emerald-500 to-teal-500" icon={<Clock className="h-5 w-5" />} title="Total Settlement" value={totalSettlement} />
        <KpiCard accent="from-rose-500 to-pink-500" icon={<Wallet className="h-5 w-5" />} title="Available Client Withdraw" value={totalClientBalance} highlight />
        <KpiCard accent="from-amber-500 to-orange-500" icon={<Wallet className="h-5 w-5" />} title="Successful Withdraw" value={successWithdraw} />
      </section>

      {/* Charts row */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Volume Area */}
        <div className="xl:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold">{volumeTitle}</h3>
            <span className="text-xs text-neutral-400">
              {selectedMerchant === 'all' ? 'Semua client' : 'Filtered by client'} • {statusFilter === 'all' ? 'All status' : statusFilter}
            </span>
          </div>

          <div className="h-64 relative text-indigo-400">
            {loadingVolume ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">Loading chart…</div>
            ) : volumeSeries.length === 0 || volumeSeries.every(d => d.amount === 0 && d.count === 0) ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">No data for selected filters</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volumeSeries} margin={{ left: 6, right: 12, top: 10 }}>
                  <defs>
                    <linearGradient id="grad-amount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis
                    tickFormatter={(v: number) => new Intl.NumberFormat('id-ID', { notation: 'compact' }).format(v)}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(v: number, key) => {
                      if (key === 'amount') {
                        return [v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' }), 'Amount']
                      }
                      return [v.toLocaleString('id-ID'), 'Count']
                    }}
                    labelFormatter={(_, payload) => {
                      const p = payload && payload[0] && (payload[0].payload as any)
                      if (granularity === 'hour' && p?.key) {
                        const [ymd, hh] = p.key.split(' ')
                        const [y, m, d] = ymd.split('-')
                        return `${d}-${m}-${y} • ${hh}:00 WIB`
                      }
                      if (granularity === 'day' && p?.key) {
                        const [y, m, d] = (p.key as string).split('-')
                        return `${d}-${m}-${y}`
                      }
                      return ''
                    }}
                  />
                  <Area type="monotone" dataKey="amount" name="Amount" stroke="currentColor" fill="url(#grad-amount)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {!loadingVolume && volumeSeries.length > 0 && (
            <div className="mt-3 text-xs text-neutral-400">
              Total amount:{' '}
              <b>
                {volumeSeries
                  .reduce((a, b) => a + (b.amount || 0), 0)
                  .toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
              </b>{' '}
              • Total tx: <b>{volumeSeries.reduce((a, b) => a + (b.count || 0), 0).toLocaleString('id-ID')}</b>
            </div>
          )}
        </div>

        {/* Top Profit Bar */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold">Top Profit Sub</h3>
            <span className="text-xs text-neutral-400">Top 6</span>
          </div>
          <div className="h-64 relative text-emerald-400">
            {loadingProfitSub ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">Loading chart…</div>
            ) : topProfit.length === 0 ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProfit} margin={{ left: 6, right: 12, top: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v: number) => new Intl.NumberFormat('id-ID', { notation: 'compact' }).format(v)} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(v: number) => v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                  />
                  <Bar dataKey="value" name="Profit" fill="currentColor" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* Wallet balances */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Wallet Balances</h2>
        </div>
        {loadingBalances ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="h-24 rounded-2xl border border-neutral-800 animate-pulse bg-neutral-900" />
            <div className="h-24 rounded-2xl border border-neutral-800 animate-pulse bg-neutral-900" />
            <div className="h-24 rounded-2xl border border-neutral-800 animate-pulse bg-neutral-900" />
          </div>
        ) : balanceError ? (
          <div className="text-sm text-rose-400">{balanceError}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {subBalances.map(s => (
              <div key={s.id} className="rounded-2xl border border-neutral-800 p-4 bg-neutral-900/70 shadow-sm hover:shadow transition-shadow">
                <div className="text-xs uppercase tracking-wide text-neutral-400">{s.name}</div>
                <div className="mt-1 text-xl font-semibold">
                  {s.balance.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Admin Withdraw Form */}
      {isSuperAdmin && (
        <div className="rounded-2xl border border-neutral-800 p-4 sm:p-5 bg-neutral-900/70 shadow-sm">
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
        </div>
      )}

      {/* Profit per sub (cards) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Profit per sub</h2>
        </div>
        {loadingProfitSub ? (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Loading profit…
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {!loadingProfit && (
              <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-900/70 shadow-sm">
                <div className="text-sm text-neutral-400">Total profit</div>
                <div className="mt-1 text-xl font-semibold">
                  {totalProfit.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                </div>
              </div>
            )}
            {profitSubs.length > 0 ? (
              profitSubs.map(p => (
                <div key={p.subMerchantId} className="rounded-2xl border border-neutral-800 p-4 bg-neutral-900/70 shadow-sm">
                  <div className="text-sm text-neutral-400">{p.name ?? p.subMerchantId}</div>
                  <div className="mt-1 text-xl font-semibold">
                    {p.profit.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-neutral-800 p-6 text-center text-sm text-neutral-400">No data</div>
            )}
          </div>
        )}
      </section>

      {/* Transactions & Withdraw History */}
      <div className="grid grid-cols-1 2xl:grid-cols-3 gap-6">
        <div className="2xl:col-span-2 space-y-6">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-sm">
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
          </div>
        </div>
        <section className="2xl:col-span-1 rounded-2xl border border-neutral-800 p-4 sm:p-5 bg-neutral-900/70 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Withdrawal History</h2>
          <WithdrawalHistory loadingWd={loadingWd} withdrawals={withdrawals} />
        </section>
      </div>

      {/* Admin Withdrawals Table */}
      {isSuperAdmin && (
        <section className="rounded-2xl border border-neutral-800 p-4 sm:p-5 bg-neutral-900/70 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Admin Withdrawals</h2>
          {loadingAdminWd ? (
            <div className="text-sm text-neutral-400">Loading withdrawals…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900/60">
                    <th className="text-left font-medium px-3 py-2">Date</th>
                    <th className="text-left font-medium px-3 py-2">Wallet</th>
                    <th className="text-left font-medium px-3 py-2">Bank</th>
                    <th className="text-left font-medium px-3 py-2">Account No.</th>
                    <th className="text-left font-medium px-3 py-2">Account Name</th>
                    <th className="text-left font-medium px-3 py-2">Amount</th>
                    <th className="text-left font-medium px-3 py-2">PG Ref ID</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {adminWithdrawals.length ? (
                    adminWithdrawals.map(a => (
                      <tr key={a.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(a.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-3 py-2">{a.wallet}</td>
                        <td className="px-3 py-2">{a.bankName}</td>
                        <td className="px-3 py-2">{a.accountNumber}</td>
                        <td className="px-3 py-2">{a.accountName}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium">
                          {a.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                        </td>
                        <td className="px-3 py-2">{a.pgRefId ?? '-'}</td>
                        <td className="px-3 py-2">{a.status}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-neutral-400">No withdrawals</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function KpiCard({
  icon,
  title,
  value,
  highlight = false,
  accent = 'from-indigo-500 to-violet-500',
}: {
  icon: React.ReactNode
  title: string
  value: number
  highlight?: boolean
  accent?: string
}) {
  return (
    <div className={`rounded-2xl border border-neutral-800 shadow-sm p-4 sm:p-5 bg-neutral-900/70 ${highlight ? 'ring-1 ring-rose-400/20' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-neutral-400">{title}</div>
          <div className="text-xl font-semibold">
            {value.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
          </div>
        </div>
        <div className={`h-11 w-11 inline-grid place-items-center rounded-xl border border-neutral-800 bg-gradient-to-br ${accent} text-white shadow`}>
          {icon}
        </div>
      </div>
    </div>
  )
}
