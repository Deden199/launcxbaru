// app/admin/settings/page.tsx (atau SettingsPage.tsx)
'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import styles from './SettingsPage.module.css'

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

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.card}>Loading…</div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <header className={styles.header}>
          <h1>Settings</h1>
        </header>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.formGroup}>
          <label className={styles.label}>Minimum Withdraw</label>
          <input
            type="number"
            className={styles.input}
            value={minW}
            onChange={e => setMinW(e.target.value)}
            placeholder="e.g. 10000"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Maximum Withdraw</label>
          <input
            type="number"
            className={styles.input}
            value={maxW}
            onChange={e => setMaxW(e.target.value)}
            placeholder="e.g. 500000"
          />
        </div>
        <button
          onClick={save}
          className={styles.button}
          disabled={loading}
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
