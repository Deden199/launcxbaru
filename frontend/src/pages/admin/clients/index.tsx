'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Search, X, Building2, UserPlus, KeyRound, Loader2, CheckCircle2, AlertCircle, Copy, Check } from 'lucide-react'

interface Client {
  id: string
  name: string
  apiKey: string
  apiSecret: string
  isActive: boolean
  feePercent: number
  feeFlat: number
  defaultProvider: string
  forceSchedule?: string
  parentClient?: { id: string; name: string }
  children?: { id: string; name: string }[]
  balance: number
}

type CreateResp = {
  client: Client
  defaultUser: { email: string; password: string }
}

type CredsState = {
  client: Client
  defaultUser?: { email: string; password: string }
}

export default function ApiClientsPage() {
  useRequireAuth()

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // form state
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newFeePercent, setNewFeePercent] = useState<number>(0.5)
  const [newFeeFlat, setNewFeeFlat] = useState<number>(0)
  const [newParentId, setNewParentId] = useState<string>('')
  const [newDefaultProvider, setNewDefaultProvider] = useState<string>('hilogate')
  const [newForceSchedule, setNewForceSchedule] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  // search
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState(search)

  // creds modal
  const [creds, setCreds] = useState<CredsState | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const copyTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

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

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    setErr('')
    try {
      const res = await api.get<Client[]>('/admin/clients')
      setClients(res.data || [])
    } catch {
      setErr('Gagal memuat daftar client')
      setClients([])
    } finally {
      setLoading(false)
    }
  }

  const filteredClients = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(c => c.name.toLowerCase().includes(q) || c.id.includes(q))
  }, [clients, debouncedSearch])

  async function addClient() {
    if (!newName.trim() || !newEmail.trim()) {
      setErr('Nama dan email tidak boleh kosong')
      return
    }
    setErr('')
    setSubmitting(true)
    try {
      const payload: any = {
        name: newName.trim(),
        email: newEmail.trim(),
        feePercent: newFeePercent,
        feeFlat: newFeeFlat,
        defaultProvider: newDefaultProvider,
        forceSchedule: newForceSchedule || null,
      }
      if (newParentId) payload.parentClientId = newParentId

      const res = await api.post<CreateResp>('/admin/clients', payload)
      setClients(cs => [res.data.client, ...cs])
      setCreds(res.data)
      setCopiedField(null)
      setNewName('')
      setNewEmail('')
      setNewFeePercent(0.5)
      setNewFeeFlat(0)
      setNewParentId('')
      setNewDefaultProvider('hilogate')
      setNewForceSchedule('')
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menambah client')
    } finally {
      setSubmitting(false)
    }
  }


  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-grid h-11 w-11 place-items-center rounded-xl border border-neutral-800 bg-neutral-900">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">API Clients</h1>
              <p className="text-xs text-neutral-400">Kelola client, kredensial, dan konfigurasi default PG.</p>
            </div>
          </div>
          <div className="text-sm text-neutral-400">
            {loading ? 'Memuat…' : `${clients.length.toLocaleString('id-ID')} client`}
          </div>
        </header>

        {/* Error banner */}
        {err && (
          <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} /> <span>{err}</span>
            </div>
          </div>
        )}

        {/* Create form card */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          <div className="mb-4 flex items-center gap-2">
            <UserPlus size={16} />
            <h2 className="text-base font-semibold">Create New Client</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              placeholder="Client Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
            />
            <input
              placeholder="Client Email"
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
            />
            <select
              value={newDefaultProvider}
              onChange={e => setNewDefaultProvider(e.target.value)}
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
            >
              <option value="hilogate">Hilogate</option>
              <option value="oy">OY Indonesia</option>
              <option value="gidi">Gidi</option>
            </select>
            <select
              value={newForceSchedule}
              onChange={e => setNewForceSchedule(e.target.value)}
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
            >
              <option value="">Force Schedule: Auto</option>
              <option value="weekday">Weekday</option>
              <option value="weekend">Weekend</option>
            </select>
            {/* Optional: parent selector (commented in source) */}
            {/* <select
              value={newParentId}
              onChange={(e) => setNewParentId(e.target.value)}
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
            >
              <option value="">No Parent</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select> */}
            {/* Fees (commented in source) */}
            {/* <input
              placeholder="Fee %"
              type="number"
              step={0.001}
              min={0}
              max={100}
              value={newFeePercent}
              onChange={e => setNewFeePercent(parseFloat(e.target.value) || 0)}
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
            />
            <input
              placeholder="Fee Flat"
              type="number"
              step="0.01"
              min={0}
              value={newFeeFlat}
              onChange={e => setNewFeeFlat(parseFloat(e.target.value) || 0)}
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
            /> */}
            <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
              <button
                onClick={addClient}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {submitting ? 'Menambahkan…' : 'Tambah Client'}
              </button>
            </div>
          </div>

          {/* Inline error after form */}
          {err && <div className="mt-3 text-xs text-rose-300">{err}</div>}
        </div>

        {/* Creds Modal */}
        {creds && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound size={16} />
                  <h3 className="text-base font-semibold">Client Credentials</h3>
                </div>
                <span className="text-xs text-neutral-400">{creds.client.name}</span>
              </div>
              {creds.defaultUser && (
                <div className="mb-4 space-y-2 text-sm">
                  <div>
                    <span className="text-neutral-400">Email:</span>{' '}
                    <code className="rounded bg-neutral-950 px-1.5 py-0.5 font-mono">{creds.defaultUser.email}</code>
                  </div>
                  <div>
                    <span className="text-neutral-400">Password:</span>{' '}
                    <code className="rounded bg-neutral-950 px-1.5 py-0.5 font-mono">{creds.defaultUser.password}</code>
                  </div>
                </div>
              )}
              <div className="space-y-3">
                <div className="space-y-1">
                  <span className="text-xs text-neutral-400">API Key</span>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-neutral-950 px-1.5 py-0.5 text-xs font-mono">{creds.client.apiKey}</code>
                    <button
                      type="button"
                      onClick={() => handleCopy(creds.client.apiKey, 'apiKey')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1 text-xs font-medium hover:bg-neutral-800"
                    >
                      {copiedField === 'apiKey' ? <Check size={14} /> : <Copy size={14} />}
                      {copiedField === 'apiKey' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-neutral-400">API Secret</span>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-neutral-950 px-1.5 py-0.5 text-xs font-mono">{creds.client.apiSecret}</code>
                    <button
                      type="button"
                      onClick={() => handleCopy(creds.client.apiSecret, 'apiSecret')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 px-2.5 py-1 text-xs font-medium hover:bg-neutral-800"
                    >
                      {copiedField === 'apiSecret' ? <Check size={14} /> : <Copy size={14} />}
                      {copiedField === 'apiSecret' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => {
                    setCreds(null)
                    setCopiedField(null)
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="max-w-md">
          <div className="relative">
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
              <Search size={16} />
            </div>
            <input
              id="client-search"
              placeholder="Cari client atau ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search clients"
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-900 pl-9 pr-9 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
            />
            {search && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-neutral-400 hover:bg-neutral-800"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Clients table */}
        {loading ? (
          <div className="grid place-items-center py-10 text-sm text-neutral-400">Memuat…</div>
        ) : filteredClients.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-neutral-800 py-14 text-sm text-neutral-400">
            {clients.length === 0 ? 'Belum ada client' : 'No clients found'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-800">
            <table className="min-w-full divide-y divide-neutral-800 text-sm">
              <thead className="bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {filteredClients.map(c => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCreds({ client: c })
                            setCopiedField(null)
                          }}
                          className="rounded-lg border border-neutral-800 px-3 py-1 text-xs hover:bg-neutral-800"
                        >
                          View Credentials
                        </button>
                        <a
                          href={`/admin/clients/${c.id}`}
                          className="rounded-lg border border-neutral-800 px-3 py-1 text-xs hover:bg-neutral-800"
                        >
                          Edit
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
