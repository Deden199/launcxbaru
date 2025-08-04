import { useEffect, useState } from 'react'
import Select from 'react-select'
import { CheckCircle } from 'lucide-react'
import api from '@/lib/api'
import { SubBalance } from '@/types/dashboard'
import styles from '@/pages/Dashboard.module.css'

interface AdminWithdrawFormProps {
  subBalances: SubBalance[]
  selectedSub: string
  setSelectedSub: (v: string) => void
  wdAmount: string
  setWdAmount: (v: string) => void
  wdAccount: string
  setWdAccount: (v: string) => void
  wdBank: string
  setWdBank: (v: string) => void
  wdName: string
  otp: string
  setOtp: (v: string) => void
  bankOptions: { value: string; label: string }[]
  isValid: boolean
  busy: { validating: boolean; submitting: boolean }
  error: string
  validateBankAccount: () => void
  handleAdminWithdraw: (e: React.FormEvent) => void
}

export default function AdminWithdrawForm({
  subBalances,
  selectedSub,
  setSelectedSub,
  wdAmount,
  setWdAmount,
  wdAccount,
  setWdAccount,
  wdBank,
  setWdBank,
  wdName,
  otp,
  setOtp,
  bankOptions,
  isValid,
  busy,
  error,
  validateBankAccount,
  handleAdminWithdraw
}: AdminWithdrawFormProps) {
  const [requiresOtp, setRequiresOtp] = useState(false)

  useEffect(() => {
    api
      .get('/admin/2fa/status')
      .then(res => setRequiresOtp(res.data.totpEnabled))
      .catch(() => {})
  }, [])
  return (
    <section className={styles.cardSection} style={{ marginTop: 32 }}>
      <h2>Withdraw Wallet</h2>
      <form onSubmit={handleAdminWithdraw} className={styles.withdrawForm}>
        <select value={selectedSub} onChange={e => setSelectedSub(e.target.value)}>
          {subBalances.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Amount"
          value={wdAmount}
          onChange={e => setWdAmount(e.target.value)}
          required
        />
        <div style={{ minWidth: 160 }}>
          <Select
            options={bankOptions}
            value={bankOptions.find(o => o.value === wdBank) || null}
            onChange={opt => setWdBank(opt?.value || '')}
            placeholder="Select bank…"
            isSearchable
            styles={{
              container: b => ({ ...b, width: '100%' }),
              control: b => ({ ...b, minHeight: '2.5rem' })
            }}
          />
        </div>
        <input
          type="text"
          placeholder="Account No"
          value={wdAccount}
          onChange={e => setWdAccount(e.target.value)}
          required
        />
        <div className={styles.readonlyWrapper}>
          <input readOnly placeholder="Account Name" value={wdName} />
          {isValid && <CheckCircle className={styles.validIcon} size={18} />}
        </div>
        <button type="button" onClick={validateBankAccount} disabled={busy.validating}>
          {busy.validating ? 'Validating…' : 'Validate'}
        </button>
        {requiresOtp && (
          <input
            type="text"
            placeholder="OTP"
            value={otp}
            onChange={e => setOtp(e.target.value)}
            required
          />
        )}
        <button type="submit" disabled={!isValid || !!error || busy.submitting}>
          {busy.submitting ? 'Submitting…' : 'Withdraw'}
        </button>
        {error && <span className={styles.error}>{error}</span>}
      </form>
    </section>
  )
}
