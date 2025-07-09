// File: src/pages/client/callback.tsx
'use client'

import { useState, useEffect } from 'react'
import { Bell, Copy, CheckCircle, AlertCircle } from 'lucide-react'
import apiClient from '@/lib/apiClient'
import styles from './CallbackPage.module.css'

export default function CallbackPage() {
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMessage, setPwMessage] = useState('')
  const [pwError, setPwError] = useState(false)
  useEffect(() => {
    apiClient
      .get('/client/callback-url')
      .then(res => {
        setUrl(res.data.callbackUrl || '')
        setSecret(res.data.callbackSecret || '')
      })
      .catch(() => {
        setMessage('Gagal memuat data callback')
        setIsError(true)
      })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    setIsError(false)
    try {
      const res = await apiClient.post('/client/callback-url', { callbackUrl: url })
      setUrl(res.data.callbackUrl)
      if (res.data.callbackSecret) setSecret(res.data.callbackSecret)
      setMessage('Callback URL & Secret berhasil disimpan!')
    } catch {
      setMessage('Gagal menyimpan callback URL')
      setIsError(true)
    } finally {
      setSaving(false)
    }
  }

  const copySecret = () => {
    if (secret) {
      navigator.clipboard.writeText(secret)
      setMessage('Secret berhasil disalin!')
      setIsError(false)
    }
  }
    const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setPwMessage('Konfirmasi password tidak cocok')
      setPwError(true)
      return
    }
    setPwSaving(true)
    setPwMessage('')
    setPwError(false)
    try {
      await apiClient.post('/client/change-password', {
        oldPassword,
        newPassword,
      })
      setPwMessage('Password berhasil diubah!')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setPwMessage('Gagal mengubah password')
      setPwError(true)
    } finally {
      setPwSaving(false)
    }
  }


  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.header}>
          <Bell size={28} className={styles.icon} />
          <h1 className={styles.title}>Callback Settings</h1>
        </div>

        <div className={styles.field}>
          <label htmlFor="cbUrl" className={styles.label}>Transactions Callback URL</label>
          <input
            id="cbUrl"
            type="url"
            className={styles.input}
            placeholder="https://your-domain.com/callback"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Callback Secret</label>
          <div className={styles.secretWrapper}>
            <input
              type="text"
              className={`${styles.input} ${styles.secretInput}`}
              readOnly
              value={secret}
              placeholder="Secret akan muncul di sini"
            />
            <button
              type="button"
              className={styles.copyButton}
              onClick={copySecret}
            >
              <Copy size={20} />
            </button>
          </div>
        </div>

        <button
          className={styles.button}
          onClick={handleSave}
          disabled={saving || url.trim() === ''}
        >
          {saving ? 'Menyimpan…' : 'Simpan Callback'}
        </button>

        {message && (
          <div className={styles.messageWrapper}>
            {isError ? (
              <AlertCircle size={20} className={styles.errorIcon} />
            ) : (
              <CheckCircle size={20} className={styles.successIcon} />
            )}            <span className={`${styles.message} ${isError ? styles.error : styles.success}`}>{message}</span>
          </div>
        )}
    
        <div className={styles.sectionDivider} />
        <h2 className={styles.subtitle}>Change Password</h2>

        <div className={styles.field}>
          <label className={styles.label}>Password Lama</label>
          <input
            type="password"
            className={styles.input}
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            disabled={pwSaving}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Password Baru</label>
          <input
            type="password"
            className={styles.input}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            disabled={pwSaving}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Konfirmasi Password Baru</label>
          <input
            type="password"
            className={styles.input}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            disabled={pwSaving}
          />
        </div>

        <button
          className={styles.button}
          onClick={handleChangePassword}
          disabled={pwSaving || !oldPassword || !newPassword}
        >
          {pwSaving ? 'Menyimpan…' : 'Ganti Password'}
        </button>

        {pwMessage && (
          <div className={styles.messageWrapper}>
            {pwError ? (
              <AlertCircle size={20} className={styles.errorIcon} />
            ) : (
              <CheckCircle size={20} className={styles.successIcon} />
            )}
            <span className={`${styles.message} ${pwError ? styles.error : styles.success}`}>{pwMessage}</span>
          </div>
        )}
      </div>
    </div>
  )
}

