import React, { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import styles from './AdminUsersPage.module.css'

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
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const loadUsers = async () => {
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
    }
  }

  useEffect(() => { loadUsers() }, [])

  const addUser = async () => {
    if (!name || !email || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await api.post<AdminUser>('/admin/users', { name, email, password, role })
      setUsers(prev => [res.data, ...prev])
      setName(''); setEmail(''); setPassword('')
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to add')
    } finally {
      setLoading(false)
    }
  }

  const deactivateUser = async (id: string) => {
    if (!confirm('Deactivate this admin?')) return
    try {
      await api.delete(`/admin/users/${id}`)
      setUsers(prev => prev.filter(u => u.id !== id))
    } catch {}
  }

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Admin Management</h1>

      <section className={styles.formCard}>
        <h2 className={styles.subtitle}>Add New Admin</h2>
        <div className={styles.formGrid}>
          <input
            className={styles.input}
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <select
            className={styles.input}
            value={role}
            onChange={e => setRole(e.target.value)}
          >
            <option value="ADMIN">ADMIN</option>
            <option value="SUPER_ADMIN">SUPER ADMIN</option>
            <option value="MODERATOR">MODERATOR</option>
          </select>
        </div>
        <div className={styles.actionRow}>
          <button
            onClick={addUser}
            disabled={loading}
            className={styles.btnPrimary}
          >
            {loading ? 'Adding…' : 'Add Admin'}
          </button>
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
      </section>

      <section className={styles.tableCard}>
        <input
          className={styles.searchInput}
          placeholder="Search admins"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <table className={styles.table}>
          <thead className={styles.thead}>
            <tr>
              {['Name', 'Email', 'Role', 'Actions'].map(header => (
                <th key={header} className={styles.th}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(u => (
              <tr key={u.id} className={styles.tr}>
                <td className={styles.td}>{u.name}</td>
                <td className={styles.td}>{u.email}</td>
                <td className={styles.td}>{u.role}</td>
                <td className={styles.td}>
                  <button
                    onClick={() => deactivateUser(u.id)}
                    className={styles.btnDanger}
                  >Deactivate</button>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={4} className={styles.emptyText}>No admins available.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

