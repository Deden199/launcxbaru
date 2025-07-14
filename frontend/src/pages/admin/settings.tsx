'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

export default function SettingsPage() {
  useRequireAuth()
  const [minW, setMinW] = useState('')
  const [maxW, setMaxW] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<{ data: Record<string,string> }>('/admin/settings')
      .then(res => {
        setMinW(res.data.data.withdraw_min || '')
        setMaxW(res.data.data.withdraw_max || '')
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setLoading(true)
    setError('')
    try {
      await api.put('/admin/settings', {
        withdraw_min: minW,
        withdraw_max: maxW
      })
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="p-8">Loading...</div>

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      {error && <p className="text-red-600">{error}</p>}
      <div>
        <label className="block font-medium">Minimum Withdraw</label>
        <input
          type="number"
          className="border rounded p-2 w-60"
          value={minW}
          onChange={e => setMinW(e.target.value)}
        />
      </div>
      <div>
        <label className="block font-medium">Maximum Withdraw</label>
        <input
          type="number"
          className="border rounded p-2 w-60"
          value={maxW}
          onChange={e => setMaxW(e.target.value)}
        />
      </div>
      <button onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded">
        Save
      </button>
    </div>
  )
}