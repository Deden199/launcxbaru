'use client'

import React, { useState, useEffect } from 'react'
import apiClient from '@/lib/apiClient'
import axios from 'axios'
import { oyCodeMap } from '../../utils/oyCodeMap'
import DatePicker from 'react-datepicker'
import Select from 'react-select'

import 'react-datepicker/dist/react-datepicker.css'
import {
  Plus,
  Wallet,
  Clock,
  FileText,
  X,
  CheckCircle,
  ArrowUpDown,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import styles from './WithdrawPage.module.css'

type ClientOption = { id: string; name: string }

interface Withdrawal {
  id: string
  refId: string

  bankName: string
  accountNumber: string
    accountName: string      // ← baru

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

  provider: string
  balance: number
}

function deriveAlias(fullName: string) {
  const parts = fullName.trim().split(' ')
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}




export default function WithdrawPage() {
  /* ──────────────── Dashboard data ──────────────── */
  const [balance, setBalance] = useState(0)
  const [pending, setPending] = useState(0)
  const [pageError, setPageError] = useState('')
const [dateRange, setDateRange] = useState<[Date|null, Date|null]>([null, null])
const [startDate, endDate] = dateRange

  /* ──────────────── Withdrawals list ──────────────── */
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)

  /* ──────────────── Parent–Child ──────────────── */
  const [children, setChildren]           = useState<ClientOption[]>([])
  const [selectedChild, setSelectedChild] = useState<'all' | string>('all')
// data sub-merchant untuk source withdraw
const [subs, setSubs] = useState<SubMerchant[]>([])
// selectedSub akan sama dengan selectedChild di awal
const [selectedSub, setSelectedSub] = useState<string>(selectedChild)

  /* ──────────────── Modal & Form state ──────────────── */
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

  /* ──────────────── Filters & pagination ──────────────── */
  const [searchRef, setSearchRef] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([])
const bankOptions = banks.map(b => ({
  value: b.code,
  label: b.name
}));
  /* ──────────────── Initial fetch ──────────────── */
  useEffect(() => {
    const sub = subs.find(s => s.id === selectedSub)
    const provider = sub?.provider || 'hilogate'
    apiClient
      .get<{ banks: { code: string; name: string }[] }>('/banks', { params: { provider } })
            .then(res => setBanks(res.data.banks))
      .catch(console.error)
  }, [selectedSub, subs])

useEffect(() => {
  apiClient
    .get<SubMerchant[]>('/client/withdrawals/submerchants')
    .then(res => {
      setSubs(res.data)
      // <-- tambahkan ini:
      if (res.data.length > 0) {
        setSelectedSub(res.data[0].id)
      }
    })
    .catch(console.error)
}, [])


  useEffect(() => {
    setLoading(true)
    setPageError('')

    Promise.all([
      apiClient.get<{ balance: number; totalPending: number; children: ClientOption[] }>('/client/dashboard', {
        params: { clientId: selectedChild }
      }),
      apiClient.get<{ data: Withdrawal[] }>('/client/withdrawals', {
        params: { clientId: selectedChild }
      }),
    ])
      .then(([dash, hist]) => {
        setBalance(dash.data.balance)
        setPending(dash.data.totalPending ?? 0)
        if (children.length === 0) setChildren(dash.data.children)
        setWithdrawals(hist.data.data)
      })
      .catch(err => setPageError('Failed to load data'))
      .finally(() => setLoading(false))
  }, [selectedChild])

  /* ──────────────── Helpers ──────────────── */
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
      setForm(f => ({
        ...f,
        accountName:      '',
        accountNameAlias: '',
        bankName:         '',
        branchName:       '',
      }))
      setIsValid(false)
    }
  }

  const validateAccount = async () => {
  setBusy(b => ({ ...b, validating: true }))
  setError('')
  try {

      const provider = subs.find(s => s.id === selectedSub)!.provider
      const payloadBankCode = provider === 'oy'
        ? oyCodeMap[form.bankCode.toLowerCase()]
        : form.bankCode
    // 1) Override validateStatus supaya axios gak langsung throw
    const res = await apiClient.post(
      '/client/withdrawals/validate-account',
      {
        bank_code: payloadBankCode,
        account_number: form.accountNumber,
        sourceProvider: provider,
        subMerchantId: selectedSub,
      },
      {
        validateStatus: () => true // semua status dianggap “OK” di level axios
      }
    )

    // 2) Tangani berdasarkan HTTP status
    if (res.status === 200 && res.data.status === 'valid') {
      // berhasil validasi
      const holder  = res.data.account_holder as string
      const bankObj = banks.find(b => b.code === form.bankCode)

      setForm(f => ({
        ...f,
        accountName:      holder,
        accountNameAlias: deriveAlias(holder),
        bankName:         bankObj?.name || '',
        branchName:       '',
      }))
      setIsValid(true)

    } else {
      // baik 400 maupun 500 atau status lain, baca pesan backend atau fallback
      const msg = res.data.error || 'Rekening bank tidak ditemukan'
      setIsValid(false)
      setError(msg)
    }

  } catch {
    // benar‑benar gagal koneksi / exception lain
    setIsValid(false)
    setError('Gagal koneksi ke server')
  } finally {
    setBusy(b => ({ ...b, validating: false }))
  }
}

const submit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!isValid || error) return;
  setBusy(b => ({ ...b, submitting: true }));
  setError('');

  try {
    // 1) Tentukan provider & kode bank payload
    const provider = subs.find(s => s.id === selectedSub)!.provider; // 'hilogate' | 'oy'
    const payloadBankCode = provider === 'oy'
      ? oyCodeMap[form.bankCode.toLowerCase()]
      : form.bankCode;

    // 2) Siapkan body
    const body: any = {
      subMerchantId:      selectedSub,
      sourceProvider:     provider,
      account_number:     form.accountNumber,
      bank_code:          payloadBankCode,
      account_name_alias: form.accountNameAlias,
      amount:             +form.amount,
      otp:                form.otp,
    };
    if (provider === 'oy') {
      body.bank_name     = form.bankName;
      body.account_name  = form.accountName;
    }

    // 3) Kirim tanpa auto‑throw untuk status ≥400
    const res = await apiClient.post(
      '/client/withdrawals',
      body,
      { validateStatus: () => true }
    );

    // 4) Tangani berdasarkan HTTP status
    if (res.status === 201) {
      // sukses: refresh data & tutup modal
      const [dash, hist] = await Promise.all([
        apiClient.get('/client/dashboard'),
        apiClient.get<{ data: Withdrawal[] }>('/client/withdrawals', {
          params: { clientId: selectedChild }
        }),
      ]);
      setBalance(dash.data.balance);
      setPending(dash.data.totalPending ?? 0);
      setWithdrawals(hist.data.data);
      setForm(f => ({
        ...f,
        amount: '',
        accountName: '',
        accountNameAlias: '',
        bankName: '',
        branchName: '',
        otp: '',
      }));
      setIsValid(false);
      setOpen(false);

    } else if (res.status === 400) {
      // validasi gagal: tampilkan pesan backend
      setError(res.data.error || 'Data tidak valid');

    } else {
      // server error (>=500) atau status lain
      setError('Submit gagal: periksa lagi informasi rekening bank');
    }

  } catch {
    // benar‑benar network / exception lain
    setError('Gagal koneksi ke server');
  } finally {
    setBusy(b => ({ ...b, submitting: false }));
  }
}


  const exportToExcel = () => {
    const rows = [
      ['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name', 'Amount', 'Fee', 'Net Amount', 'Status'],
      ...withdrawals.map(w => [
        new Date(w.createdAt).toLocaleDateString(),
                w.completedAt ? new Date(w.completedAt).toLocaleDateString() : '-',

        w.refId,
        w.bankName,
        w.accountNumber,
        w.accountName,      // ← baru

        w.amount,
        w.amount - w.netAmount,
        w.netAmount,
        w.status,
      ]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Withdrawals')
    XLSX.writeFile(wb, 'withdrawals.xlsx')
  }

  /* ──────────────── Filtering & paging ──────────────── */
  const filtered = withdrawals.filter(w => {
    const d = new Date(w.createdAt)
    if (searchRef && !w.refId.includes(searchRef)) return false
    if (statusFilter && w.status !== statusFilter) return false
if (startDate && d < startDate) return false
if (endDate   && d > new Date(endDate.setHours(23,59,59))) return false

    return true
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageData = filtered.slice((page - 1) * perPage, page * perPage)

  return (
    <div className={styles.page}>
      {pageError && <p className={styles.pageError}>{pageError}</p>}
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

      {/* === STAT CARDS ===================================================== */}
      <div className={styles.statsGrid}>
        {/* Active balance
        <div className={`${styles.statCard} ${styles.activeCard}`}>
          <Wallet size={28} />
          <div>
            <p className={styles.statTitle}>Active Balance</p>
            <p className={styles.statValue}>
              Rp {balance.toLocaleString()}
            </p>
          </div>
        </div> */}
      {subs.length > 0 && (
        <div className={`${styles.statCard} ${styles.activeCard}`}>
          {subs.map(s => (
            <div
              key={s.id}
              className={s.id === selectedSub ? `${styles.statCard} ${styles.selected}` : styles.statCard}
             onClick={() => setSelectedSub(s.id)}
           >
 <h4>
   {s.name || (s.provider
     ? s.provider.charAt(0).toUpperCase() + s.provider.slice(1)
     : `Sub-wallet ${s.id.substring(0,6)}`)}<br></br>
 </h4>             
 <p>Rp {s.balance.toLocaleString()}</p>           </div>
          ))}
        </div>
      )}

        {/* Pending balance */}
        <div className={`${styles.statCard} ${styles.pendingCard}`}>
          <Clock size={28} />
          <div>
            <p className={styles.statTitle}>Pending Balance</p>
            <p className={styles.statValue}>
              Rp {pending.toLocaleString()}
            </p>
          </div>
        </div>

        {/* New withdrawal button */}
        <button className={styles.newBtn} onClick={() => setOpen(true)}>
          <Plus size={18} /> New Withdrawal
        </button>
      </div>

      {/* === HISTORY ======================================================= */}
      <section className={styles.historyCard}>
        <div className={styles.historyHeader}>
          <h3>Withdrawal History</h3>
          <button onClick={exportToExcel} className={styles.exportBtn}>
            <FileText size={16} /> Excel
          </button>
        </div>

     <div className={styles.filters}>
  <input
    className={styles.input}
    placeholder="Search Ref"
    value={searchRef}
    onChange={e => { setSearchRef(e.target.value); setPage(1) }}
  />
  <select
    className={styles.select}
    value={statusFilter}
    onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
  >
    <option value="">All Status</option>
    <option>PENDING</option>
    <option>COMPLETED</option>
    <option>FAILED</option>
  </select>

  {/* Date range picker */}
  <DatePicker
    selectsRange
    startDate={startDate}
    endDate={endDate}
    onChange={(update: [Date|null,Date|null]) => {
      setDateRange(update)
      // kalau langsung ingin apply:
      if (update[0] && update[1]) {
        setDateFrom(update[0].toISOString().slice(0,10))
        setDateTo(update[1].toISOString().slice(0,10))
        setPage(1)
      }
    }}
    isClearable
    placeholderText="Select Date Range..."
    maxDate={new Date()}
    dateFormat="dd-MM-yyyy"
    className={styles.input}
  />
</div>

        {/* table */}
        <div className={styles.tableWrap}>
          {loading ? (
            <p>Loading…</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  {['Created At', 'Completed At', 'Ref ID', 'Bank', 'Account', 'Account Name','Amount', 'Fee', 'Net Amount', 'Status'].map(
                    h => (
                      <th key={h}>
                        {h}
                        <ArrowUpDown size={14} className={styles.sortIcon} />
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                  {pageData.length ? (
                  pageData.map(w => (
                    <tr key={w.id}>
                      <td>{new Date(w.createdAt).toLocaleDateString()}</td>
                                            <td>{w.completedAt ? new Date(w.completedAt).toLocaleDateString() : '-'}</td>

                      <td>{w.refId}</td>
                      <td>{w.bankName}</td>
                            <td>{w.accountNumber}</td>     {/* ← tambahkan ini */}

      <td>{w.accountName}</td>       
                      <td>Rp {w.amount.toLocaleString()}</td>
                                            <td>Rp {(w.amount - w.netAmount).toLocaleString()}</td>
                      <td>Rp {w.netAmount.toLocaleString()}</td>
                      <td>
                        <span className={styles[`s${w.status}`]}>
                          {w.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className={styles.noData}>
                      No data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* pagination */}
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
              {[5, 10, 20].map(n => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
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
      </section>

      {/* === MODAL ========================================================= */}
      {open && (
        <div
          className={styles.modalOverlay}
          onClick={() => setOpen(false)}
        >
          <div
            className={styles.modal}
            onClick={e => e.stopPropagation()}
          >
            <button
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
            <h3 className={styles.modalTitle}>New Withdrawal</h3>

            <form className={styles.form} onSubmit={submit}>
<label>Sub-wallet</label>
<div className={styles.selectWrapper}>
  <select
    name="subMerchantId"
    className={styles.subMerchantSelect}
    value={selectedSub}
    onChange={e => setSelectedSub(e.target.value)}
    required
  >
    {subs.map(s => (
      <option key={s.id} value={s.id}>{s.name || s.provider}</option>

    ))}
  </select>
  <span className={styles.selectArrow} />
</div>

              {/* bank */}
<div className={styles.field}>
  <label>Bank</label>
  <Select
    options={bankOptions}
    value={bankOptions.find(o => o.value === form.bankCode) || null}
    onChange={opt => {
      const code = opt?.value || ''
      handleChange({ // pakai handleChange agar reset state form otomatis
        target: { name: 'bankCode', value: code }
      } as any)
    }}
    placeholder="Cari atau pilih bank…"
    isSearchable
    styles={{
      container: base => ({ ...base, width: '100%' }),
      control:   base => ({ ...base, minHeight: '2.5rem' }),
    }}
  />
</div>


              {/* account number */}
              <div className={styles.field}>
                <label>Account Number</label>
                <input
                  name="accountNumber"
                  value={form.accountNumber}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* account name */}
              <div className={styles.field}>
                <label>Account Name</label>
                <div className={styles.readonlyWrapper}>
                  <input
                    readOnly
                    value={form.accountName}
                    placeholder="Isi otomatis setelah validasi"
                  />
                  {isValid && (
                    <CheckCircle className={styles.validIcon} size={18} />
                  )}
                </div>
              </div>

              {/* amount */}
              <div className={styles.field}>
                <label>Amount</label>
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  required
                />
              </div>
              {/* otp */}
              <div className={styles.field}>
                <label>OTP</label>
                <input
                  name="otp"
                  value={form.otp}
                  onChange={handleChange}
                  required
                />
              </div>
              {/* actions */}
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.btnWarn}
                  onClick={validateAccount}
                  disabled={busy.validating}
                >
                  {busy.validating ? 'Validating…' : 'Validate'}
                </button>
                <button
                  type="submit"
                  className={styles.btnPrimary}
                  disabled={!isValid || !!error || busy.submitting}
                >
                  {busy.submitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>

              {error && <p className={styles.error}>{error}</p>}
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
