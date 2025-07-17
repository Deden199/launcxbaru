'use client'

import React, { useState, useEffect, FormEvent } from 'react'
import { Bell, Copy, CheckCircle, AlertCircle } from 'lucide-react'
import apiClient from '@/lib/apiClient'
import QRCode from 'qrcode'
import styles from './CallbackPage.module.css'

export default function CallbackPage() {
  // Callback settings
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  // Password change
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMessage, setPwMessage] = useState('')
  const [pwError, setPwError] = useState(false)

  // 2FA state
  const [loading2FA, setLoading2FA] = useState(true)
  const [is2FAEnabled, setIs2FAEnabled] = useState(false)
  const [qr, setQr] = useState('')
  const [otp, setOtp] = useState('')
  const [faMsg, setFaMsg] = useState('')

  useEffect(() => {
    // Fetch callback settings
    apiClient.get('/client/callback-url')
      .then(res => {
        setUrl(res.data.callbackUrl || '')
        setSecret(res.data.callbackSecret || '')
      })
      .catch(() => {
        setMessage('Failed to load callback data')
        setIsError(true)
      })

    // Fetch 2FA status
    const fetch2FA = async () => {
      try {
        const res = await apiClient.get('/client/2fa/status')
        setIs2FAEnabled(res.data.totpEnabled)
      } catch {}
      finally {
        setLoading2FA(false)
      }
    }
    fetch2FA()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    setIsError(false)
    try {
      const res = await apiClient.post('/client/callback-url', { callbackUrl: url })
      setUrl(res.data.callbackUrl)
      if (res.data.callbackSecret) setSecret(res.data.callbackSecret)
      setMessage('Callback URL & Secret saved successfully!')
    } catch {
      setMessage('Failed to save callback URL')
      setIsError(true)
    } finally {
      setSaving(false)
    }
  }

  const copySecret = () => {
    if (secret) {
      navigator.clipboard.writeText(secret)
      setMessage('Secret copied to clipboard!')
      setIsError(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setPwMessage('Password confirmation does not match')
      setPwError(true)
      return
    }
    setPwSaving(true)
    setPwMessage('')
    setPwError(false)
    try {
      await apiClient.post('/client/change-password', { oldPassword, newPassword })
      setPwMessage('Password changed successfully!')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setPwMessage('Failed to change password')
      setPwError(true)
    } finally {
      setPwSaving(false)
    }
  }

  const setup2FA = async () => {
    try {
      const { data } = await apiClient.post('/client/2fa/setup')
      const svg = await QRCode.toDataURL(data.otpauthUrl)
      setQr(svg)
      setFaMsg('Scan the QR code and enter the next OTP')
    } catch {
      setFaMsg('Failed to set up 2FA')
    }
  }

  const enable2FA = async () => {
    try {
      await apiClient.post('/client/2fa/enable', { code: otp })
      setFaMsg('2FA enabled successfully')
      setIs2FAEnabled(true)
      setQr('')
      setOtp('')
    } catch {
      setFaMsg('Invalid OTP')
    }
  }

const regenerate2FA = async () => {
  setIs2FAEnabled(false);        // ← biar masuk ke blok qr
  await setup2FA();
  setFaMsg('New 2FA secret generated, please scan the QR again');
}


  // Prevent autofill by handling OTP in a form
  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await enable2FA()
  }
  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.header}>
          <Bell size={28} className={styles.icon} />
          <h1 className={styles.title}>Callback & 2FA Settings</h1>
        </div>

        {/* Callback URL Section */}
        <div className={styles.field}>
          <label htmlFor="cbUrl" className={styles.label}>Transactions Callback URL</label>
          <input
            id="cbUrl"
            type="url"
            className={styles.input}
            placeholder="https://domain.com/callback"
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
            />
            <button type="button" className={styles.copyButton} onClick={copySecret}>
              <Copy size={20} />
            </button>
          </div>
        </div>
        <button
          className={styles.button}
          onClick={handleSave}
          disabled={saving || !url.trim()}
        >
          {saving ? 'Saving…' : 'Save Callback'}
        </button>
        {message && (
          <div className={styles.messageWrapper}>
            {isError
              ? <AlertCircle size={20} className={styles.errorIcon} />
              : <CheckCircle size={20} className={styles.successIcon} />}
            <span className={`${styles.message} ${isError ? styles.error : styles.success}`}>
              {message}
            </span>
          </div>
        )}

        <div className={styles.sectionDivider} />

        {/* Two-Factor Authentication Section */}
        <h2 className={styles.subtitle}>Two-Factor Authentication</h2>
        {loading2FA ? (
          <p>Loading 2FA status…</p>
        ) : is2FAEnabled ? (
          <button onClick={regenerate2FA} className={styles.button}>Regenerate 2FA</button>
        ) : qr ? (
         <form autoComplete="off" onSubmit={handleVerify}>
           {/* dummy fields to absorb browser autofill */}
           <input type="text" name="username" autoComplete="username" style={{display:'none'}} />
           <input type="password" name="new-password" autoComplete="new-password" style={{display:'none'}} />

           <img src={qr} alt="QR Code" className={styles.qrImage} />
           <div className={`${styles.field} ${styles.twoFaField}`}>
             <input
               type="text"
               name="otp"
               autoComplete="off"
               placeholder="Enter 2FA code"
               value={otp}
               onChange={e => setOtp(e.target.value)}
               inputMode="numeric"
               pattern="\d*"
               className={styles.input}
             />
             <button type="submit" className={styles.button}>Verify OTP</button>
           </div>
           {faMsg && <p className={styles.message}>{faMsg}</p>}
         </form>
        ) : (
          <button onClick={setup2FA} className={styles.button}>Setup 2FA</button>
        )}

        <div className={styles.sectionDivider} />

        {/* Change Password Section */}
        <h2 className={styles.subtitle}>Change Password</h2>
        <div className={styles.field}>
          <label className={styles.label}>Old Password</label>
          <input
            type="password"
            className={styles.input}
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            disabled={pwSaving}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>New Password</label>
          <input
            type="password"
            className={styles.input}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            disabled={pwSaving}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Confirm New Password</label>
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
          {pwSaving ? 'Saving…' : 'Change Password'}
        </button>
        {pwMessage && (
          <div className={styles.messageWrapper}>
            {pwError
              ? <AlertCircle size={20} className={styles.errorIcon} />
              : <CheckCircle size={20} className={styles.successIcon} />}
            <span className={`${styles.message} ${pwError ? styles.error : styles.success}`}>
              {pwMessage}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
