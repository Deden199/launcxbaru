'use client'

import { useEffect, useRef, useState } from 'react'
import apiClient from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import * as XLSX from 'xlsx'
import { Plus, Clock, FileText, X, CheckCircle, ArrowUpDown } from 'lucide-react'
import { oyCodeMap } from '../../utils/oyCodeMap'
import { gidiChannelMap } from '../../utils/gidiChannelMap'

type ClientOption = { id: string; name: string }
type Provider = 'hilogate' | 'oy' | 'gidi' | string

interface Withdrawal {
  id: string
  refId: string
  bankName: string
  accountNumber: string
  accountName: string
  wallet: string
  netAmount: number
  withdrawFeePercent: number
  withdrawFeeFlat: number
  amount: number
  status: string
  createdAt: string
  completedAt?: string
}
interface SubMerchant {
  id: string
  name: string
  provider: Provider
  balance: number
}

function deriveAlias(fullName: string) {
  const parts = fullName.trim().split(' ')
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

export default function WithdrawPage() {
  // ── Dashboard
  const [balance, setBalance] = useState(0)
  const [pending, setPending] = useState(0)
  const [pageError, setPageError] = useState<string>('')

  // ── Parent–Child & Subwallets
  const [children, setChildren] = useState<ClientOption[]>([])
  const [selectedChild, setSelectedChild] = useState<'all' | string>('all')
  const [subs, setSubs] = useState<SubMerchant[]>([])
  const [selectedSub, setSelectedSub] = useState<string>('') // default isi setelah fetch

  // ── Banks
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([])

  // ── Withdrawals
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)

  // ── Modal/Form
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    bankCode: '',
    accountNumber: '',
    accountName: '',
    accountNameAlias: '',
    bankName: '',
    branchName: '',
    amount: '',
    otp: '',
  })
  const [isValid, setIsValid] = useState(false)
  const [busy, setBusy] = useState({ validating: false, submitting: false })
  const [error, setError] = useState('')

  // ── Filters & pagination
  const [searchRef, setSearchRef] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [total, setTotal] = useState(0)
  const [startDate, endDate] = dateRange

  // ── Fetch stabil: unmount guard
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Banks (once)
  useEffect(() => {
    let cancelled = false
    apiClient.get<{ banks: { code: string; name: string }[] }>('/banks')
      .then(res => { if (!cancelled) setBanks(res.data.banks) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Subwallets by child
  useEffect(() => {
    let cancelled = false
    apiClient.get<SubMerchant[]>('/client/withdrawals/submerchants', { params: { clientId: selectedChild } })
      .then(res => {
        if (cancelled) return
        setSubs(res.data || [])
        if (!selectedSub || !res.data.find(s => s.id === selectedSub)) {
          if (res.data[0]) setSelectedSub(res.data[0].id)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChild])

  async function fetchWithdrawals() {
    const res = await apiClient.get<{ data: Withdrawal[]; total: number }>(
      '/client/withdrawals',
      {
        params: {
          clientId: selectedChild,
          page,
          limit: perPage,
          status: statusFilter,
          date_from: startDate?.toISOString(),
          date_to: endDate?.toISOString(),
          ref: searchRef,
        },
      },
    )
    return res.data
  }

  // Dashboard on child change
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const dash = await apiClient.get<{ balance: number; totalPending: number; children: ClientOption[] }>(
          '/client/dashboard', { params: { clientId: selectedChild } }
        )
        if (cancelled || !mountedRef.current) return
        setBalance(dash.data.balance)
        setPending(dash.data.totalPending ?? 0)
        if (children.length === 0) setChildren(dash.data.children || [])
      } catch (e: any) {
        if (cancelled || !mountedRef.current) return
        setPageError(e?.message || 'Failed to load data')
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChild])

  // Withdrawals - refetch on pagination/filter change
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true); setPageError('')
      try {
        const res = await fetchWithdrawals()
        if (cancelled || !mountedRef.current) return
        setWithdrawals(res.data)
        setTotal(res.total)
      } catch (e: any) {
        if (cancelled || !mountedRef.current) return
        setPageError(e?.message || 'Failed to load data')
      } finally {
        if (cancelled || !mountedRef.current) return
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChild, page, statusFilter, startDate, endDate, searchRef, perPage])

  // ── Handlers
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    if (name === 'amount') {
      const n = +value
      if (!n || n <= 0) setError('Amount harus > 0')
      else if (n > balance) setError('Melebihi saldo')
      else setError('')
    } else setError('')
    if (name === 'bankCode' || name === 'accountNumber') {
      setForm(f => ({ ...f, accountName: '', accountNameAlias: '', bankName: '', branchName: '' }))
      setIsValid(false)
    }
  }

  const validateAccount = async () => {
    setBusy(b => ({ ...b, validating: true })); setError('')
    try {
      const res = await apiClient.post(
        '/client/withdrawals/validate-account',
        { bank_code: form.bankCode, account_number: form.accountNumber },
        { validateStatus: () => true }
      )
      if (res.status === 200 && res.data.status === 'valid') {
        const holder = res.data.account_holder as string
        const bankObj = banks.find(b => b.code === form.bankCode)
        setForm(f => ({
          ...f,
          accountName: holder,
          accountNameAlias: deriveAlias(holder),
          bankName: bankObj?.name || '',
          branchName: '',
        }))
        setIsValid(true)
      } else {
        setIsValid(false)
        setError(res.data.error || 'Rekening bank tidak ditemukan')
      }
    } catch {
      setIsValid(false)
      setError('Gagal koneksi ke server')
    } finally {
      setBusy(b => ({ ...b, validating: false }))
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || error) return
    setBusy(b => ({ ...b, submitting: true })); setError('')
    try {
      const provider = subs.find(s => s.id === selectedSub)?.provider || 'hilogate'
      const bankObj = banks.find(b => b.code === form.bankCode)
      const payloadBankCode =
        provider === 'oy'
          ? oyCodeMap[bankObj?.name.toLowerCase() || ''] ?? form.bankCode
          : provider === 'gidi'
          ? gidiChannelMap[bankObj?.name.toLowerCase() || ''] ?? form.bankCode
          : form.bankCode

      const body: any = {
        subMerchantId: selectedSub,
        sourceProvider: provider,
        account_number: form.accountNumber,
        bank_code: payloadBankCode,
        account_name_alias: form.accountNameAlias,
        amount: +form.amount,
        otp: form.otp,
      }
      if (provider === 'oy' || provider === 'gidi') {
        body.bank_name = form.bankName
        body.account_name = form.accountName
      }

      const res = await apiClient.post('/client/withdrawals', body, { validateStatus: () => true })
      if (res.status === 201) {
        const [dash, list] = await Promise.all([
          apiClient.get('/client/dashboard', { params: { clientId: selectedChild } }),
          fetchWithdrawals(),
        ])
        if (!mountedRef.current) return
        setBalance(dash.data.balance)
        setPending(dash.data.totalPending ?? 0)
        setWithdrawals(list.data)
        setTotal(list.total)
        setForm(f => ({ ...f, amount: '', accountName: '', accountNameAlias: '', bankName: '', branchName: '', otp: '' }))
        setIsValid(false)
        setOpen(false)
      } else if (res.status === 400) {
        setError(res.data.error || 'Data tidak valid')
      } else if (res.status === 403) {
        setError('Forbidden: Tidak dapat withdraw menggunakan akun parent')
      } else {
        setError('Submit gagal: periksa lagi informasi rekening bank')
      }
    } catch {
      setError('Gagal koneksi ke server')
    } finally {
      setBusy(b => ({ ...b, submitting: false }))
    }
  }

  const exportToExcel = () => {
    const rows = [
      ['Created At','Completed At','Ref ID','Bank','Account','Account Name','Wallet','Amount','Fee','Net Amount','Status'],
      ...withdrawals.map(w => [
        new Date(w.createdAt).toLocaleString('id-ID',{ dateStyle:'short', timeStyle:'short' }),
        w.completedAt ? new Date(w.completedAt).toLocaleString('id-ID',{ dateStyle:'short', timeStyle:'short' }) : '-',
        w.refId, w.bankName, w.accountNumber, w.accountName, w.wallet,
        w.amount, w.amount - w.netAmount, w.netAmount, w.status
      ])
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Withdrawals')
    XLSX.writeFile(wb, 'withdrawals.xlsx')
  }

  // ── Pagination
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {pageError && (
          <p className="mb-4 rounded-xl border border-rose-900/40 bg-rose-950/40 p-3 text-rose-300">
            {pageError}
          </p>
        )}

        {/* Child selector */}
        {children.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <label className="text-sm text-neutral-400">Pilih Child:</label>
            <select
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
              value={selectedChild}
              onChange={e => { setSelectedChild(e.target.value as any); setPage(1) }}
            >
              <option value="all">Semua Child</option>
              {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {/* Stats */}
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* Sub-wallets */}
          <div className="md:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="mb-2 text-sm text-neutral-400">Sub-wallets</div>
            <div className="flex flex-wrap gap-3">
              {subs.length ? subs.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSub(s.id)}
                  className={`rounded-xl border px-3 py-2 text-left transition
                    ${s.id === selectedSub
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-neutral-800 hover:bg-neutral-800/60'}`}
                >
                  <div className="text-sm font-medium">
                    {s.name || (s.provider ? s.provider[0].toUpperCase()+s.provider.slice(1) : `Sub ${s.id.slice(0,6)}`)}
                  </div>
                  <div className="text-xs text-neutral-400">Rp {s.balance.toLocaleString()}</div>
                </button>
              )) : <div className="text-sm text-neutral-500">Tidak ada sub-wallet.</div>}
            </div>
          </div>

          {/* Pending */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 flex items-center gap-3">
            <Clock className="opacity-70" />
            <div>
              <div className="text-sm text-neutral-400">Pending Balance</div>
              <div className="text-lg font-semibold">Rp {pending.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Withdrawal</h2>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800/60"
          >
            <Plus size={18} /> New Withdrawal
          </button>
        </div>

        {/* History Card */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-base font-semibold">Withdrawal History</h3>
            <button
              onClick={exportToExcel}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-800/60"
            >
              <FileText size={16} /> Export Excel
            </button>
          </div>

          {/* Filters */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              placeholder="Search Ref…"
              value={searchRef}
              onChange={e => { setSearchRef(e.target.value); setPage(1) }}
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
            />
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
            >
              <option value="">All Status</option>
              <option>PENDING</option>
              <option>COMPLETED</option>
              <option>FAILED</option>
            </select>
<div className="relative md:col-span-2">
  <DatePicker
    selectsRange
    startDate={startDate}
    endDate={endDate}
    onChange={(upd: [Date | null, Date | null]) => {
      setDateRange(upd)
      if (upd[0] && upd[1]) setPage(1)
    }}
    isClearable
    placeholderText="Select Date Range…"
    maxDate={new Date()}
    dateFormat="dd-MM-yyyy"
    // input
    className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
    // calendar panel
    calendarClassName="!bg-neutral-900 !text-neutral-100 !border !border-neutral-800 !rounded-xl !shadow-2xl !overflow-hidden"
    weekDayClassName={() => '!text-neutral-400 !font-semibold'}
    dayClassName={() =>
      'rounded-md !text-neutral-100 hover:!bg-neutral-800 focus:!bg-neutral-800'
    }
    // keep popper above everything, avoid clipping—no custom modifiers
    withPortal
    portalId="datepicker-portal"
    popperPlacement="bottom-start"
    showPopperArrow={false}
    // custom header
    renderCustomHeader={({ date, decreaseMonth, increaseMonth, prevMonthButtonDisabled, nextMonthButtonDisabled }) => (
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2.5 py-2">
        <button
          type="button"
          onClick={decreaseMonth}
          disabled={prevMonthButtonDisabled}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="text-sm font-semibold">
          {date.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button
          type="button"
          onClick={increaseMonth}
          disabled={nextMonthButtonDisabled}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          aria-label="Next month"
        >
          ›
        </button>
      </div>
    )}
  />

  {(startDate || endDate) && (
    <button
      type="button"
      onClick={() => setDateRange([null, null])}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800/60"
    >
      Clear
    </button>
  )}
</div>

          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            {loading ? (
              <div className="p-4 text-sm text-neutral-400">Loading…</div>
            ) : (
              <table className="min-w-[1100px] w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                    {['Created At','Completed At','Ref ID','Bank','Account','Account Name','Wallet','Amount','Fee','Net Amount','Status'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-neutral-300">
                        <span className="inline-flex items-center gap-1">{h}<ArrowUpDown size={14} className="opacity-50" /></span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.length ? withdrawals.map(w => (
                    <tr key={w.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(w.createdAt).toLocaleString('id-ID',{ dateStyle:'short', timeStyle:'short' })}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {w.completedAt ? new Date(w.completedAt).toLocaleString('id-ID',{ dateStyle:'short', timeStyle:'short' }) : '-'}
                      </td>
                      <td className="px-3 py-2">{w.refId}</td>
                      <td className="px-3 py-2">{w.bankName}</td>
                      <td className="px-3 py-2">{w.accountNumber}</td>
                      <td className="px-3 py-2">{w.accountName}</td>
                      <td className="px-3 py-2">{w.wallet}</td>
                      <td className="px-3 py-2 whitespace-nowrap">Rp {w.amount.toLocaleString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">Rp {(w.amount - w.netAmount).toLocaleString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold">Rp {w.netAmount.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium
                          ${w.status === 'COMPLETED'
                            ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
                            : w.status === 'PENDING'
                            ? 'border-amber-900/40 bg-amber-950/40 text-amber-300'
                            : w.status === 'FAILED'
                            ? 'border-rose-900/40 bg-rose-950/40 text-rose-300'
                            : 'border-neutral-800 bg-neutral-900/60 text-neutral-300'}`}>
                          {w.status}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={11} className="px-3 py-10 text-center text-neutral-400">No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="inline-flex items-center gap-2 text-sm">
              <span>Rows</span>
              <select
                value={perPage}
                onChange={e => { setPerPage(+e.target.value); setPage(1) }}
                className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-2 text-sm outline-none"
              >
                {[5,10,20].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex h-9 items-center rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
              >‹</button>
              <span className="min-w-[70px] text-center">{page}/{totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="inline-flex h-9 items-center rounded-lg border border-neutral-800 px-2.5 disabled:opacity-50 hover:bg-neutral-800/60"
              >›</button>
            </div>
          </div>
        </section>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New Withdrawal</h3>
              <button className="rounded-lg border border-neutral-800 p-1 hover:bg-neutral-800/60" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form className="grid gap-3" onSubmit={submit}>
              {/* Sub-wallet */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Sub-wallet</label>
                <select
                  name="subMerchantId"
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  value={selectedSub}
                  onChange={e => setSelectedSub(e.target.value)}
                  required
                >
                  {subs.map(s => <option key={s.id} value={s.id}>{s.name || s.provider}</option>)}
                </select>
              </div>

              {/* Bank */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Bank</label>
                <select
                  name="bankCode"
                  value={form.bankCode}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                >
                  <option value="">Pilih bank…</option>
                  {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
              </div>

              {/* Account Number */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Account Number</label>
                <input
                  name="accountNumber"
                  value={form.accountNumber}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  required
                />
              </div>

              {/* Account Name (readonly) */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Account Name</label>
                <div className="relative">
                  <input
                    readOnly
                    value={form.accountName}
                    placeholder="Isi otomatis setelah validasi"
                    className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  />
                  {isValid && <CheckCircle size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400" />}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Amount</label>
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  required
                />
              </div>

              {/* OTP */}
              <div>
                <label className="mb-1 block text-sm text-neutral-300">OTP</label>
                <input
                  name="otp"
                  value={form.otp}
                  onChange={handleChange}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none"
                  required
                />
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={validateAccount}
                  disabled={busy.validating}
                  className="inline-flex items-center justify-center rounded-lg border border-amber-900/40 bg-amber-950/40 px-3 py-2 text-sm hover:bg-amber-900/30 disabled:opacity-50"
                >
                  {busy.validating ? 'Validating…' : 'Validate'}
                </button>
                <button
                  type="submit"
                  disabled={!isValid || !!error || busy.submitting}
                  className="inline-flex items-center justify-center rounded-lg border border-indigo-900/40 bg-indigo-950/40 px-3 py-2 text-sm hover:bg-indigo-900/30 disabled:opacity-50"
                >
                  {busy.submitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>

              {!!error && <p className="mt-2 rounded-lg border border-rose-900/40 bg-rose-950/40 p-2 text-sm text-rose-300">{error}</p>}
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
