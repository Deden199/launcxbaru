'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'
import { format } from 'date-fns'
import { Loader2, Calendar, Info, Save } from 'lucide-react'

export default function SettingsPage() {
  useRequireAuth()

  const [minW, setMinW] = useState('')
  const [maxW, setMaxW] = useState('')
  const [settlementCron, setSettlementCron] = useState('0 16 * * *')
  const [ipWhitelist, setIpWhitelist] = useState('')
  const [overrideDates, setOverrideDates] = useState<Date[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      setSuccess('')
      try {
        const res = await api.get<{ data: Record<string, string> }>('/admin/settings')
        const d = res.data.data || {}
        setMinW(d.withdraw_min || '')
        setMaxW(d.withdraw_max || '')
        setSettlementCron(d.settlement_cron || '0 16 * * *')
        setIpWhitelist(d.s2s_ip_whitelist || '')
        const raw = d.weekend_override_dates || ''
        const dates = raw
          .split(',')
          .map(s => new Date(s.trim()))
          .filter(d => !isNaN(d.getTime()))
        setOverrideDates(dates)
      } catch {
        setError('Failed to load settings')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const save = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const datesString = overrideDates.map(d => format(d, 'yyyy-MM-dd')).join(', ')
      await api.put('/admin/settings', {
        withdraw_min: minW,
        withdraw_max: maxW,
        weekend_override_dates: datesString,
        settlement_cron: settlementCron,
        s2s_ip_whitelist: ipWhitelist,
      })
      setSuccess('Settings saved successfully.')
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center bg-neutral-950 text-neutral-100">
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <p className="text-xs text-neutral-400">
              Konfigurasi withdraw, jadwal settlement, dan tanggal libur.
            </p>
          </div>
        </header>

        {/* Alerts */}
        {error && (
          <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
            {success}
          </div>
        )}

        {/* Card (force dark) */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Withdraw limits */}
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Withdraw</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-neutral-300">Minimum Withdraw</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={minW}
                    onChange={(e) => setMinW(e.target.value)}
                    placeholder="e.g. 10000"
                    className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-neutral-300">Maximum Withdraw</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={maxW}
                    onChange={(e) => setMaxW(e.target.value)}
                    placeholder="e.g. 500000"
                    className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                  />
                </div>
              </div>
            </section>

            {/* Settlement cron */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold">Settlement</h2>
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Settlement Cron</label>
                <input
                  type="text"
                  value={settlementCron}
                  onChange={(e) => setSettlementCron(e.target.value)}
                  placeholder="e.g. 0 16 * * *"
                  className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                />
                <div className="mt-1 flex items-start gap-2 text-xs text-neutral-400">
                  <Info size={14} className="mt-0.5" />
                  <span>Cron format: minute hour day-of-month month day-of-week (WIB recommended).</span>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-neutral-300">S2S IP Whitelist</label>
                <input
                  type="text"
                  value={ipWhitelist}
                  onChange={(e) => setIpWhitelist(e.target.value)}
                  placeholder="e.g. 103.150.10.1, 103.150.10.0/24"
                  className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                />
                <p className="mt-1 text-xs text-neutral-400">Pisahkan beberapa IP dengan koma. CIDR diperbolehkan.</p>
              </div>
            </section>
          </div>

          {/* Holidays */}
          <section className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Holiday Dates</h2>
              <div className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 px-2.5 py-1 text-xs">
                <Calendar size={14} />
                <span>Pilih beberapa tanggal</span>
              </div>
            </div>

            {/* DayPicker wrapper (force dark frame) */}
            <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
              <DayPicker
                mode="multiple"
                selected={overrideDates}
                onSelect={(dates) => setOverrideDates(dates || [])}
                className="p-3 text-neutral-100"
              />
            </div>

            {/* Selected dates badges */}
            {overrideDates.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {overrideDates.map((d) => (
                  <span
                    key={d.toISOString()}
                    className="inline-flex items-center gap-1 rounded-full border border-indigo-900/40 bg-indigo-950/40 px-2.5 py-1 text-xs font-medium text-indigo-300"
                  >
                    {format(d, 'yyyy-MM-dd')}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
