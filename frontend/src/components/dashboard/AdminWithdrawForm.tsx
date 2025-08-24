import { useEffect, useMemo, useState } from 'react'
import Select, { StylesConfig, SingleValue } from 'react-select'
import { CheckCircle, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { SubBalance } from '@/types/dashboard'

type BankOption = { value: string; label: string }

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
  bankOptions: BankOption[]
  isValid: boolean
  busy: { validating: boolean; submitting: boolean }
  error: string
  validateBankAccount: () => void
  handleAdminWithdraw: (e: React.FormEvent) => void
}

export default function AdminWithdrawForm(props: AdminWithdrawFormProps) {
  const {
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
  } = props

  const [requiresOtp, setRequiresOtp] = useState(false)

  useEffect(() => {
    api
      .get('/admin/2fa/status')
      .then(res => setRequiresOtp(Boolean(res.data?.totpEnabled)))
      .catch(() => {})
  }, [])

  // react-select dark theme
  const selectStyles = useMemo<StylesConfig<BankOption, false>>(
    () => ({
      container: base => ({ ...base, width: '100%' }),
      control: (base, state) => ({
        ...base,
        minHeight: '2.5rem',
        backgroundColor: '#0a0a0a',
        borderColor: state.isFocused ? '#4f46e5' : '#262626',
        boxShadow: state.isFocused ? '0 0 0 4px rgba(79,70,229,.2)' : 'none',
        transition: 'border-color .15s, box-shadow .15s',
        ':hover': { borderColor: state.isFocused ? '#4f46e5' : '#404040' },
        borderRadius: 12,
        cursor: 'pointer',
      }),
      valueContainer: base => ({ ...base, padding: '0 10px', color: '#e5e5e5' }),
      singleValue: base => ({ ...base, color: '#e5e5e5' }),
      input: base => ({ ...base, color: '#e5e5e5' }),
      placeholder: base => ({ ...base, color: '#9ca3af' }),
      menu: base => ({
        ...base,
        backgroundColor: '#0a0a0a',
        border: '1px solid #262626',
        borderRadius: 12,
        overflow: 'hidden',
        zIndex: 50,
      }),
      option: (base, state) => ({
        ...base,
        backgroundColor: state.isSelected
          ? '#4f46e5'
          : state.isFocused
          ? '#171717'
          : 'transparent',
        color: state.isSelected ? '#ffffff' : '#e5e5e5',
        cursor: 'pointer',
      }),
      indicatorSeparator: base => ({ ...base, backgroundColor: '#262626' }),
      dropdownIndicator: base => ({ ...base, color: '#9ca3af' }),
      clearIndicator: base => ({ ...base, color: '#9ca3af' }),
    }),
    []
  )

  const selectedSubLabel = useMemo(() => {
    const s = subBalances.find(sb => sb.id === selectedSub)
    return s?.name ?? 'Select Wallet'
  }, [subBalances, selectedSub])

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-6 shadow-sm mt-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base sm:text-lg font-semibold text-neutral-100">Withdraw Wallet</h2>
        <span className="text-xs text-neutral-400">{selectedSubLabel}</span>
      </div>

      <form onSubmit={handleAdminWithdraw} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* Sub wallet */}
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Wallet</span>
          <select
            value={selectedSub}
            onChange={e => setSelectedSub(e.target.value)}
            className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          >
            {subBalances.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {/* Amount */}
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Amount (IDR)</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="e.g. 1500000"
            value={wdAmount}
            onChange={e => {
              // only digits
              const v = e.target.value.replace(/[^\d]/g, '')
              setWdAmount(v)
            }}
            required
            className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          />
        </label>

        {/* Bank */}
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Bank</span>
          <div className="min-w-0">
            <Select<BankOption, false>
              options={bankOptions}
              value={bankOptions.find((o: BankOption) => o.value === wdBank) || null}
              onChange={(opt: SingleValue<BankOption>) => setWdBank(opt?.value ?? '')}
              placeholder="Select bank…"
              isSearchable
              styles={selectStyles}
              // ensure menu appears above other content
              menuPortalTarget={typeof window !== 'undefined' ? document.body : undefined}
              menuPosition="fixed"
            />
          </div>
        </label>

        {/* Account number */}
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Account No</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 1234567890"
            value={wdAccount}
            onChange={e => setWdAccount(e.target.value.trim())}
            required
            className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          />
        </label>

        {/* Account name (readonly + valid icon) */}
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Account Name</span>
          <div className="relative">
            <input
              readOnly
              placeholder="—"
              value={wdName}
              className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 pr-9 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none"
            />
            {isValid && (
              <CheckCircle
                size={18}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500"
                aria-hidden="true"
              />
            )}
          </div>
        </label>

        {/* Validate button */}
        <div className="flex items-end">
          <button
            type="button"
            onClick={validateBankAccount}
            disabled={busy.validating}
            className="inline-flex w-full items-center justify-center gap-2 h-10 rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm font-medium text-neutral-100 hover:bg-neutral-800/60 disabled:opacity-60"
          >
            {busy.validating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating…
              </>
            ) : (
              'Validate'
            )}
          </button>
        </div>

        {/* OTP (conditional) */}
        {requiresOtp && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">OTP (2FA)</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
              required
              className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>
        )}

        {/* Submit */}
        <div className="flex items-end">
          <button
            type="submit"
            disabled={!isValid || !!error || busy.submitting}
            className="inline-flex w-full items-center justify-center gap-2 h-10 rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy.submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              'Withdraw'
            )}
          </button>
        </div>

        {/* Error */}
        {!!error && (
          <div className="lg:col-span-3 md:col-span-2 col-span-1">
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-xl border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </div>
          </div>
        )}
      </form>

      {/* Little footnote */}
      <p className="mt-3 text-xs text-neutral-500">
        Pastikan nama &amp; nomor rekening sesuai sebelum mengirim withdraw. Biaya/limit mengikuti kebijakan sistem.
      </p>
    </section>
  )
}
