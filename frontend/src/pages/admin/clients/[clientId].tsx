// frontend/src/pages/admin/clients/[clientId].tsx
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Loader2, Users, UserCog, Save, AlertCircle, Copy, Check } from 'lucide-react'

interface Client {
  id: string
  name: string
  apiKey: string
  apiSecret: string
  isActive: boolean
  feePercent: number
  feeFlat: number
  withdrawFeePercent: number
  withdrawFeeFlat: number
  parentClientId?: string
  childrenIds?: string[]
  defaultProvider?: string
  weekendFeePercent: number
  weekendFeeFlat: number
  forceSchedule?: string
}

type Option = { id: string; name: string }

export default function EditClientPage() {
  useRequireAuth()
  const router = useRouter()
  const { clientId } = router.query as { clientId?: string }

  const [client, setClient] = useState<Client | null>(null)
  const [options, setOptions] = useState<Option[]>([])

  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [feePercent, setFeePercent] = useState<number>(0)
  const [feeFlat, setFeeFlat] = useState<number>(0)
  const [weekendFeePercent, setWeekendFeePercent] = useState<number>(0)
  const [weekendFeeFlat, setWeekendFeeFlat] = useState<number>(0)
  const [withdrawFeePercent, setWithdrawFeePercent] = useState<number>(0)
  const [withdrawFeeFlat, setWithdrawFeeFlat] = useState<number>(0)
  const [parentClientId, setParentClientId] = useState<string>('')
  const [childrenIds, setChildrenIds] = useState<string[]>([])
  const [defaultProvider, setDefaultProvider] = useState<string>('')
  const [forceSchedule, setForceSchedule] = useState<string>('')

  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const copyTimeoutRef = useRef<number | null>(null)

  // Load client data
  useEffect(() => {
    if (!clientId) return
    const run = async () => {
      setPageLoading(true)
      setError('')
      try {
        const res = await api.get<Client>(`/admin/clients/${clientId}`)
        const c = res.data
        setClient(c)
        setName(c.name)
        setIsActive(c.isActive)
        setFeePercent(c.feePercent)
        setFeeFlat(c.feeFlat)
        setWeekendFeePercent(c.weekendFeePercent)
        setWeekendFeeFlat(c.weekendFeeFlat)
        setWithdrawFeePercent(c.withdrawFeePercent)
        setWithdrawFeeFlat(c.withdrawFeeFlat)
        setParentClientId(c.parentClientId || '')
        setChildrenIds(c.childrenIds || [])
        setDefaultProvider(c.defaultProvider || '')
        setForceSchedule(c.forceSchedule || '')
      } catch {
        setError('Gagal memuat data client')
      } finally {
        setPageLoading(false)
      }
    }
    run()
  }, [clientId])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setCopiedField(null)
  }, [client?.id])

  const handleCopy = async (value: string, field: string) => {
    try {
      if (typeof navigator === 'undefined') {
        throw new Error('Clipboard not supported')
      }
      const clipboard = navigator.clipboard
      if (!clipboard || typeof clipboard.writeText !== 'function') {
        throw new Error('Clipboard not supported')
      }
      await clipboard.writeText(value)
      setCopiedField(field)
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedField(current => (current === field ? null : current))
      }, 2000)
    } catch {
      setCopiedField(null)
    }
  }

  // Load all clients as options
  useEffect(() => {
    if (!clientId) return
    api
      .get<Option[]>('/admin/clients')
      .then(res => setOptions((res.data || []).filter(o => o.id !== clientId)))
      .catch(() => {})
  }, [clientId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name tidak boleh kosong')
      return
    }
    if (!defaultProvider) {
      setError('Default provider harus dipilih')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.put(`/admin/clients/${clientId}`, {
        name: name.trim(),
        isActive,
        feePercent,
        feeFlat,
        weekendFeePercent,
        weekendFeeFlat,
        withdrawFeePercent,
        withdrawFeeFlat,
        parentClientId: parentClientId || null,
        childrenIds,
        defaultProvider,
        forceSchedule: forceSchedule || null,
      })
      router.push('/admin/clients')
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Gagal menyimpan perubahan')
    } finally {
      setLoading(false)
    }
  }

  if (!clientId || pageLoading || !client) {
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
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-grid h-11 w-11 place-items-center rounded-xl border border-neutral-800 bg-neutral-900">
              <UserCog size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Edit Client</h1>
              <p className="text-xs text-neutral-400">Ubah detail client dan biaya.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/admin/clients/${clientId}/users`)}
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold hover:bg-neutral-800"
          >
            <Users size={14} />
            Manage Users
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-4 rounded-xl border border-neutral-800 bg-neutral-950/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-neutral-200">Credentials</span>
                <span className="text-xs text-neutral-500">Read only</span>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-neutral-400">API Key</label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    readOnly
                    value={client.apiKey}
                    className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm font-mono tracking-wide text-neutral-100 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(client.apiKey, 'apiKey')}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-neutral-800 px-4 text-xs font-semibold hover:bg-neutral-800"
                  >
                    {copiedField === 'apiKey' ? <Check size={14} /> : <Copy size={14} />}
                    {copiedField === 'apiKey' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-neutral-400">API Secret</label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    readOnly
                    value={client.apiSecret}
                    className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm font-mono tracking-wide text-neutral-100 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(client.apiSecret, 'apiSecret')}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-neutral-800 px-4 text-xs font-semibold hover:bg-neutral-800"
                  >
                    {copiedField === 'apiSecret' ? <Check size={14} /> : <Copy size={14} />}
                    {copiedField === 'apiSecret' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
            {/* Name */}
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Client Name"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              />
            </div>

            {/* Default Provider */}
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Default Provider</label>
              <select
                value={defaultProvider}
                onChange={e => setDefaultProvider(e.target.value)}
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              >
                <option value="">-- Select Provider --</option>
                <option value="hilogate">Hilogate</option>
                <option value="oy">OY Indonesia</option>
                <option value="gidi">Gidi</option>
              </select>
            </div>

            {/* Force Schedule */}
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Force Schedule</label>
              <select
                value={forceSchedule}
                onChange={e => setForceSchedule(e.target.value)}
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              >
                <option value="">Auto</option>
                <option value="weekday">Weekday</option>
                <option value="weekend">Weekend</option>
              </select>
            </div>

            {/* Active toggle */}
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Active</label>
              <button
                type="button"
                onClick={() => setIsActive(v => !v)}
                className={`relative inline-flex h-11 w-full items-center justify-between rounded-xl border px-3 text-sm ${
                  isActive
                    ? 'border-emerald-900/40 bg-emerald-950/40 text-emerald-300'
                    : 'border-neutral-800 bg-neutral-950 text-neutral-300'
                }`}
              >
                <span>{isActive ? 'Active' : 'Inactive'}</span>
                <span
                  className={`inline-block h-6 w-11 rounded-full transition ${
                    isActive ? 'bg-emerald-600' : 'bg-neutral-700'
                  }`}
                >
                  <span
                    className={`block h-6 w-6 translate-x-0 rounded-full bg-white transition ${
                      isActive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>
            </div>

            {/* Fees */}
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Transaction Fee %</label>
              <input
                type="number"
                step={0.001}
                min={0}
                max={100}
                value={feePercent}
                onChange={e => setFeePercent(parseFloat(e.target.value) || 0)}
                placeholder="0.000"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Transaction Fee Flat</label>
              <input
                type="number"
                step={0.01}
                min={0}
                value={feeFlat}
                onChange={e => setFeeFlat(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              />
            </div>

            {/* Weekend Fees */}
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Weekend Fee %</label>
              <input
                type="number"
                step={0.001}
                min={0}
                max={100}
                value={weekendFeePercent}
                onChange={e => setWeekendFeePercent(parseFloat(e.target.value) || 0)}
                placeholder="0.000"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Weekend Fee Flat</label>
              <input
                type="number"
                step={0.01}
                min={0}
                value={weekendFeeFlat}
                onChange={e => setWeekendFeeFlat(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              />
            </div>

            {/* Withdraw Fees */}
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Withdraw Fee %</label>
              <input
                type="number"
                step={0.001}
                min={0}
                max={100}
                value={withdrawFeePercent}
                onChange={e => setWithdrawFeePercent(parseFloat(e.target.value) || 0)}
                placeholder="0.000"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm text-neutral-300">Withdraw Fee Flat</label>
              <input
                type="number"
                step={0.01}
                min={0}
                value={withdrawFeeFlat}
                onChange={e => setWithdrawFeeFlat(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              />
            </div>

            {/* Parent */}
            <div className="sm:col-span-2 space-y-1">
              <label className="text-sm text-neutral-300">Parent Client</label>
              <select
                value={parentClientId}
                onChange={e => setParentClientId(e.target.value)}
                className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              >
                <option value="">None</option>
                {options.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Children chips */}
            <div className="sm:col-span-2 space-y-2">
              <label className="text-sm text-neutral-300">Children</label>
              <div className="flex flex-wrap gap-2">
                {options.map(o => {
                  const selected = childrenIds.includes(o.id)
                  return (
                    <button
                      type="button"
                      key={o.id}
                      onClick={() =>
                        setChildrenIds(ids =>
                          ids.includes(o.id) ? ids.filter(i => i !== o.id) : [...ids, o.id]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        selected
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
                      }`}
                    >
                      {o.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="sm:col-span-2 flex items-center justify-end pt-2">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {loading ? 'Menyimpan…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
