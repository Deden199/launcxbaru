'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import styles from '../../users/AdminUsersPage.module.css'

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
  const [loading, setLoading] = useState(false)

  useEffect(() => { loadUsers() }, [clientId])

  async function loadUsers() {
    if (!clientId) return
    try {
      const res = await api.get(`/admin/clients/${clientId}/users`)
      setUsers(res.data)
    } catch {
      setUsers([])
    }
  }

  const addUser = async () => {
    if (!email || !password || !clientId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.post(`/admin/clients/${clientId}/users`, { email, password })
      setUsers(prev => [res.data, ...prev])
      setEmail(''); setPassword('')
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const removeUser = async (id: string) => {
    if (!clientId || !confirm('Delete this user?')) return
    try {
      await api.delete(`/admin/clients/${clientId}/users/${id}`)
      setUsers(prev => prev.filter(u => u.id !== id))
    } catch {}
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Client Users</h1>

      <section className={styles.formCard}>
        <h2 className={styles.subtitle}>Add User</h2>
        <div className={styles.formGrid}>
          <input
            className={styles.input}
            placeholder='Email'
            type='email'
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder='Password'
            type='password'
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <button onClick={addUser} disabled={loading} className={styles.btnPrimary}>
            {loading ? 'Adding…' : 'Add User'}
          </button>
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
      </section>

      <section className={styles.tableCard}>
        <table className={styles.table}>
          <thead className={styles.thead}>
            <tr>
              <th className={styles.th}>Email</th>
              <th className={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className={styles.tr}>
                <td className={styles.td}>{u.email}</td>
                <td className={styles.td}>
                  <button onClick={() => removeUser(u.id)} className={styles.btnDanger}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={2} className={styles.emptyText}>No users available.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}