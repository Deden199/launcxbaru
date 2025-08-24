'use client'

import React, { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Shield, UserPlus, Search, Trash2, AlertCircle, CheckCircle } from 'lucide-react'

interface AdminUser {
  id: string
  name: string
  email: string
  role: string
}

export default function AdminUsersPage() {
  useRequireAuth()

  const [users, setUsers] = useState<AdminUser[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('ADMIN')
  const [error, setError] = useState('')
  const [loadingAdd, setLoadingAdd] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')

  const loadUsers = async () => {
    setLoadingList(true)
    setError('')
    try {
      const res = await api.get('/admin/users')
      let dataArray: AdminUser[] = []
      const resp = res.data as any
      if (Array.isArray(resp)) dataArray = resp
      else if (Array.isArray(resp.users)) dataArray = resp.users
      else if (Array.isArray(resp.data)) dataArray = resp.data
      setUsers(dataArray)
    } catch {
      setUsers([])
      setError('Failed to fetch users')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  const addUser = async () => {
    if (!name || !email || !password) return
    setLoadingAdd(true)
    setError('')
    setMessage('')
    try {
      const res = await api.post<AdminUser>('/admin/users', { name, email, password, role })
      setUsers(prev => [res.data, ...prev])
      setName(''); setEmail(''); setPassword('')
      setRole('ADMIN')
      setMessage('Admin added successfully')
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to add')
    } finally {
      setLoadingAdd(false)
    }
  }

  const deactivateUser = async (id: string) => {
    if (!confirm('Deactivate this admin?')) return
    setError('')
    setMessage('')
    try {
      await api.delete(`/admin/users/${id}`)
      setUsers(prev => prev.filter(u => u.id !== id))
      setMessage('Admin deactivated')
    } catch {
      setError('Failed to deactivate')
    }
  }

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  const RoleBadge = ({ r }: { r: string }) => {
    const up = (r || '').toUpperCase()
    const map: Record<string, string> = {
      SUPER_ADMIN: 'bg-fuchsia-950/40 text-fuchsia-300 border-fuchsia-900/40',
      ADMIN: 'bg-indigo-950/40 text-indigo-300 border-indigo-900/40',
      MODERATOR: 'bg-emerald-950/40 text-emerald-300 border-emerald-900/40',
    }
    const cls = map[up] ?? 'bg-neutral-900/60 text-neutral-300 border-neutral-800'
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{up}</span>
  }

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900/70">
              <Shield size={18} className="opacity-80" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Admin Management</h1>
              <p className="text-xs text-neutral-400">Create, search, and deactivate admin users</p>
            </div>
          </div>
        </header>

        {/* Messages */}
        {(message || error) && (
          <div className="mb-4">
            {message && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
                <CheckCircle size={16} /> {message}
              </div>
            )}
            {error && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                <AlertCircle size={16} /> {error}
              </div>
            )}
          </div>
        )}

        {/* Add Admin Card */}
        <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <UserPlus size={18} className="opacity-80" />
            <h2 className="text-base font-semibold">Add New Admin</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input
              className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              placeholder="Name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <input
              className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              placeholder="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <input
              className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              placeholder="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <select
              className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              value={role}
              onChange={e => setRole(e.target.value)}
            >
              <option value="ADMIN">ADMIN</option>
              <option value="SUPER_ADMIN">SUPER ADMIN</option>
              <option value="MODERATOR">MODERATOR</option>
            </select>

            <button
              onClick={addUser}
              disabled={loadingAdd || !name || !email || !password}
              className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {loadingAdd ? 'Adding…' : 'Add Admin'}
            </button>
          </div>
        </section>

        {/* List Card */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 shadow-sm">
          {/* Search */}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative w-full sm:w-80">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
              <input
                className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-900 pl-9 pr-3 text-sm placeholder:text-neutral-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Search admins…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button
              onClick={loadUsers}
              className="hidden h-10 rounded-xl border border-neutral-800 px-3 text-sm hover:bg-neutral-800/60 sm:inline-flex"
              title="Refresh"
            >
              Refresh
            </button>
          </div>

          {/* Table */}
          {loadingList ? (
            <div className="grid gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-neutral-800" />
              ))}
              <div className="sr-only">Loading users…</div>
            </div>
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="min-w-[800px] w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                    {['Name', 'Email', 'Role', 'Actions'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-neutral-300">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id} className="border-b border-neutral-800 last:border-0 hover:bg-neutral-900/60">
                      <td className="px-3 py-2">{u.name}</td>
                      <td className="px-3 py-2">{u.email}</td>
                      <td className="px-3 py-2">
                        <RoleBadge r={u.role} />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => deactivateUser(u.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-rose-900/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40"
                        >
                          <Trash2 size={14} /> Deactivate
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-sm text-neutral-400">
                        No admins available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
