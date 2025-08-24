'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { FileClock, TriangleAlert, Loader2, User } from 'lucide-react'

interface AdminLog {
  id: string
  action: string
  target?: string
  adminId: string
  admin: { name: string }
  createdAt: string
}

export default function AdminLogsPage() {
  useRequireAuth()
  const [logs, setLogs] = useState<AdminLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get<{ data: AdminLog[] }>('/admin/logs')
        setLogs(res.data.data || [])
      } catch {
        setError('Gagal memuat log')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-grid h-11 w-11 place-items-center rounded-xl border border-neutral-800 bg-neutral-900">
              <FileClock size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Admin Logs</h1>
              <p className="text-xs text-neutral-400">Aktivitas admin terbaru dan riwayat perubahan.</p>
            </div>
          </div>
          <div className="text-sm text-neutral-400">
            {loading ? 'Memuat…' : `${logs.length.toLocaleString('id-ID')} entri`}
          </div>
        </header>

        {/* Error banner */}
        {error && (
          <div className="rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            <div className="flex items-center gap-2">
              <TriangleAlert size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-neutral-800/60" />
                ))}
                <div className="flex items-center gap-2 px-1 pt-2 text-xs text-neutral-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Memuat data…
                </div>
              </div>
            ) : logs.length === 0 ? (
              <div className="mx-4 my-6 grid place-items-center rounded-xl border border-dashed border-neutral-800 py-14 text-sm text-neutral-400">
                Belum ada log
              </div>
            ) : (
              <table className="min-w-[720px] w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-y border-neutral-800 bg-neutral-900/80 backdrop-blur">
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Aksi</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Target</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Admin</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Waktu</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-neutral-800 hover:bg-neutral-900/60">
                      <td className="px-4 py-2">{log.action}</td>
                      <td className="px-4 py-2">{log.target || '–'}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-grid h-7 w-7 place-items-center rounded-lg border border-neutral-800 bg-neutral-900">
                            <User size={14} className="opacity-80" />
                          </span>
                          <span className="flex flex-col">
                            <span>{log.admin.name}</span>
                            <span className="font-mono text-[13px] text-neutral-400">{log.adminId}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('id-ID', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
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
