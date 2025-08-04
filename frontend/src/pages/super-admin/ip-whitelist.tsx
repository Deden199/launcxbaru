'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

export default function IpWhitelistPage() {
  useRequireAuth()
  const [ips, setIps] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<{ data: string[] }>('/admin/ip-whitelist')
      .then(res => setIps(res.data.data.join(', ')))
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setLoading(true)
    setError('')
    try {
      const arr = ips
        .split(',')
        .map(ip => ip.trim())
        .filter(Boolean)
      await api.put('/admin/ip-whitelist', { ips: arr })
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div>Loading…</div>

  return (
    <div style={{ padding: '1rem' }}>
      <h1>IP Whitelist</h1>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <textarea
        value={ips}
        onChange={e => setIps(e.target.value)}
        rows={4}
        style={{ width: '100%', marginBottom: '1rem' }}
        placeholder="Comma separated IPs"
      />
      <button onClick={save} disabled={loading}>
        {loading ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

