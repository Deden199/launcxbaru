'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { Building2, Phone, ChevronRight, Loader2, UserCog } from 'lucide-react'

type Merchant = {
  id: string
  name: string
  phoneNumber: string
}

export default function MerchantsListPage() {
  useRequireAuth()
  const router = useRouter()
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const r = await api.get<Merchant[]>('/admin/merchants')
        setMerchants(r.data || [])
      } catch {
        setError('Gagal memuat data merchant.')
        setMerchants([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 bg-neutral-950 text-neutral-100 min-h-screen">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-grid h-11 w-11 place-items-center rounded-xl border border-neutral-800 bg-neutral-900">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Daftar Merchant</h1>
              <p className="text-xs text-neutral-400">Kelola merchant dan pengaturannya.</p>
            </div>
          </div>
        </header>

        {/* Card */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60">
          {/* Table header + actions (optional actions area) */}
          <div className="flex items-center justify-between px-4 pb-3 pt-4">
            <div className="text-sm text-neutral-400">
              {loading
                ? 'Memuat…'
                : merchants.length
                ? `${merchants.length.toLocaleString('id-ID')} merchant`
                : 'Tidak ada merchant'}
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mx-4 mb-3 rounded-xl border border-rose-900/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}

          {/* Content */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-neutral-800/60" />
                ))}
              </div>
            ) : merchants.length === 0 ? (
              <div className="mx-4 mb-4 rounded-xl border border-dashed border-neutral-800 py-14 text-center text-sm text-neutral-400">
                Belum ada data merchant
              </div>
            ) : (
              <table className="min-w-[720px] w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-y border-neutral-800 bg-neutral-900/80 backdrop-blur">
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Nama</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Telepon</th>
                    <th className="px-4 py-2 text-left font-medium text-neutral-300">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-neutral-800 hover:bg-neutral-900/60"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="inline-grid h-8 w-8 place-items-center rounded-lg border border-neutral-800 bg-neutral-900">
                            <UserCog size={16} className="opacity-80" />
                          </div>
                          <span className="font-medium">{m.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-2 text-neutral-300">
                          <Phone size={14} className="opacity-70" />
                          <span className="truncate">{m.phoneNumber || '–'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => router.push(`/admin/merchants/${m.id}`)}
                          className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold hover:bg-neutral-800"
                        >
                          Manage
                          <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer loading indicator (compact) */}
          {loading && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-neutral-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Mengambil data…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
