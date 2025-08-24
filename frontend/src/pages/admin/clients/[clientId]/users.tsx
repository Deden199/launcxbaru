'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Users, UserPlus, Trash2, Loader2, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react'

interface ClientUser {
  id: string
  email: string
}

export default function ClientUsersPage() {
  useRequireAuth()
  const router = useRouter()
  const { clientId } = router.query as { clientId?: string }

  const [users, setUsers] = useState<ClientUser[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function loadUsers() {
    if (!clientId) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.get(`/admin/clients/${clientId}/users`)
      setUsers(res.data || [])
    } catch {
      setUsers([])
      setError('Gagal memuat users')
    } finally {
      setLoading(false)
    }
  }

  const addUser = async () => {
    if (!email.trim() || !password.trim() || !clientId) return
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.post(`/admin/clients/${clientId}/users`, { email: email.trim(), password: password.trim() })
      setUsers(prev => [res.data, ...prev])
      setEmail(''); setPassword('')
      setSuccess('User berhasil ditambahkan.')
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Gagal menambah user')
    } finally {
      setSubmitting(false)
    }
  }

  const removeUser = async (id: string) => {
    if (!clientId || !confirm('Hapus user ini?')) return
    setError('')
    setSuccess('')
    try {
      await api.delete(`/admin/clients/${clientId}/users/${id}`)
      setUsers(prev => prev.filter(u => u.id !== id))
      setSuccess('User berhasil dihapus.')
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Gagal menghapus user')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-grid h-11 w-11 place-items-center rounded-xl border border-neutral-800 bg-neutral-900">
              <Users size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Client Users</h1>
              <p className="text-xs text-neutral-400">Kelola akun pengguna untuk client ini.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/admin/clients/${clientId}`)}
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold hover:bg-neutral-800"
          >
            <ArrowLeft size={14} />
            Back
          </button>
        </header>

        {/* Alerts */}
        {error && (
          <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>{success}</span>
            </div>
          </div>
        )}

        {/* Add user card */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          <div className="mb-3 flex items-center gap-2">
            <UserPlus size={16} />
            <h2 className="text-base font-semibold">Add User</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              placeholder="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <input
              className="h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-indigo-700 focus:ring-2 focus:ring-indigo-800"
              placeholder="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <div className="sm:col-span-2 flex justify-end">
              <button
                onClick={addUser}
                disabled={submitting || !email.trim() || !password.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-600 disabled:opacity-60"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                {submitting ? 'Adding…' : 'Add User'}
              </button>
            </div>
          </div>
        </div>

        {/* Users table */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-neutral-800/60" />
                ))}
                <div className="flex items-center gap-2 px-1 pt-2 text-xs text-neutral-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Memuat data…
                </div>
              </div>
            ) : users.length === 0 ? (
              <div className="mx-4 my-6 grid place-items-center rounded-xl border border-dashed border-neutral-800 py-14 text-sm text-neutral-400">
                No users available.
              </div>
            ) : (
              <table className="min-w-[520px] w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-y border-neutral-800 bg-neutral-900/80 backdrop-blur">
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Email</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-neutral-800 hover:bg-neutral-900/60">
                      <td className="px-4 py-2">{u.email}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => removeUser(u.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-900/40"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
