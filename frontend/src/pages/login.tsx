import { useState } from 'react'
import api from '@/lib/api'
import styles from './AdminAuth.module.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await api.post('/auth/login', { email, password })
      const token = res.data.result.access_token
      localStorage.setItem('token', token)
      window.location.href = '/dashboard'
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login gagal')
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* Bisa tambahkan logo di sini */}
        <h1 className={styles.title}>Admin Dashboard</h1>
        {error && <div className={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className={styles.input}
            />
          </div>
          <button type="submit" className={styles.button}>
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}