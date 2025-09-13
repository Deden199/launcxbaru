'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Search, X, Building2, AlertCircle } from 'lucide-react'

interface Client {
  id: string
  name: string
  balance: number
}

export default function ClientBalancesPage() {
  useRequireAuth()

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState(search)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [balanceEdit, setBalanceEdit] = useState<number>(0)
  const [saving, setSaving] = useState(false)

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
      setClients((res.data || []).map(c => ({ ...c, balance: c.balance ?? 0 })))
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

  function startEdit(c: Client) {
    setEditingId(c.id)
    setBalanceEdit(c.balance)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    setErr('')
    setSaving(true)
    try {
      await api.patch(`/admin/clients/${id}/balance`, { balance: balanceEdit })
      await loadClients()
      setEditingId(null)
    } catch {
      setErr('Gagal menyimpan saldo')
    } finally {
      setSaving(false)
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
              <h1 className="text-xl font-semibold tracking-tight">Client Balances</h1>
              <p className="text-xs text-neutral-400">Kelola saldo dan top up client.</p>
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
                  <th className="px-3 py-2 text-left">Balance</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {filteredClients.map(c => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">
                      {editingId === c.id ? (
                        <input
                          type="number"
                          value={balanceEdit}
                          onChange={e => setBalanceEdit(parseFloat(e.target.value) || 0)}
                          className="w-32 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
                        />
                      ) : (
                        c.balance.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingId === c.id ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(c.id)}
                            disabled={saving}
                            className="rounded-lg bg-indigo-700 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-lg border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(c)}
                          className="rounded-lg border border-neutral-800 px-3 py-1 text-xs hover:bg-neutral-800"
                        >
                          Edit
                        </button>
                      )}
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

