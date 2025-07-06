'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import styles from './ClientAuth.module.css'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const { data } = await apiClient.post('/client/login', { email, password })
      localStorage.setItem('clientToken', data.token)
      router.push('/client/dashboard')
    } catch {
      setErr('Email atau password salah')
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Client Login</h1>

        {err && <div className={styles.error}>{err}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            className={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />

          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          <button type="submit" className={styles.button}>
            Login
          </button>
        </form>
      </div>
    </div>
  )
}