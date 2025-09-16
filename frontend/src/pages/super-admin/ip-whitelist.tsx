'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

export default function IpWhitelistPage() {
  useRequireAuth()
  const [ips, setIps] = useState('')
  const [globalIps, setGlobalIps] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api.get<{ data: string[] }>('/admin/ip-whitelist'),
      api.get<{ data: string[] }>('/admin/ip-whitelist/global'),
    ])
      .then(([localRes, globalRes]) => {
        setIps(localRes.data.data.join(', '))
        setGlobalIps(globalRes.data.data.join(', '))
      })
      .catch((e: any) => {
        setError(e.response?.data?.error || 'Failed to load IP whitelists')
      })
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    const parseIps = (value: string) =>
      value
        .split(',')
        .map(ip => ip.trim())
        .filter(Boolean)

    const isValidIp = (ip: string) => {
      const segments = ip.split('.')
      if (segments.length !== 4) return false
      return segments.every(segment => {
        if (!/^\d+$/.test(segment)) return false
        const num = Number(segment)
        return num >= 0 && num <= 255
      })
    }

    const localIps = parseIps(ips)
    const globalIpsList = parseIps(globalIps)

    const invalidLocal = localIps.filter(ip => !isValidIp(ip))
    const invalidGlobal = globalIpsList.filter(ip => !isValidIp(ip))

    if (invalidLocal.length || invalidGlobal.length) {
      const messages = [] as string[]
      if (invalidLocal.length) {
        messages.push(`Local: ${invalidLocal.join(', ')}`)
      }
      if (invalidGlobal.length) {
        messages.push(`Global: ${invalidGlobal.join(', ')}`)
      }
      setError(`Invalid IP address format — ${messages.join(' | ')}`)
      return
    }

    setSaving(true)
    setError('')
    try {
      await Promise.all([
        api.put('/admin/ip-whitelist', { ips: localIps }),
        api.put('/admin/ip-whitelist/global', { ips: globalIpsList }),
      ])
      setIps(localIps.join(', '))
      setGlobalIps(globalIpsList.join(', '))
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to save IP whitelists')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div>Loading…</div>

  return (
    <div style={{ padding: '1rem' }}>
      <h1>IP Whitelist</h1>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Merchant IP Whitelist</div>
        <textarea
          value={ips}
          onChange={e => setIps(e.target.value)}
          rows={4}
          style={{ width: '100%' }}
          placeholder="Comma separated IPv4 addresses"
        />
      </label>
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Global IP Whitelist</div>
        <textarea
          value={globalIps}
          onChange={e => setGlobalIps(e.target.value)}
          rows={4}
          style={{ width: '100%' }}
          placeholder="Comma separated IPv4 addresses"
        />
      </label>
      <button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

