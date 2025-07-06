/* Admin – CRUD Payment-Gateway Provider */
import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

type Provider = { id: string; name: string }

export default function PGProvidersPage() {
  useRequireAuth()
  const [providers, setProviders] = useState<Provider[]>([])
  const [name, setName] = useState('')

  useEffect(() => { api.get<Provider[]>('/admin/pg-providers').then(r => setProviders(r.data)) }, [])

  const add = async () => {
    if (!name.trim()) return
    const r = await api.post<Provider>('/admin/pg-providers', { name })
    setProviders(p => [...p, r.data]); setName('')
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">PG Providers</h1>
      <div className="flex mb-6 space-x-2">
        <input value={name} onChange={e => setName(e.target.value)}
          className="border px-3 py-2 rounded w-60" placeholder="Provider name" />
        <button onClick={add} className="px-4 py-2 bg-blue-600 text-white rounded">Add</button>
      </div>

      <ul className="list-disc ml-6 space-y-1">
        {providers.map(p => <li key={p.id}>{p.name}</li>)}
      </ul>
    </div>
  )
}
