'use client'

import { useState } from 'react'
import apiClient from '@/lib/apiClient'
import QRCode from 'qrcode'

export default function TwoFAPage() {
  const [qr, setQr] = useState('')
  const [otp, setOtp] = useState('')
  const [msg, setMsg] = useState('')

  const setup = async () => {
    const { data } = await apiClient.post('/client/2fa/setup')
    const url: string = data.otpauthUrl
    const svg = await QRCode.toDataURL(url)
    setQr(svg)
  }

  const enable = async () => {
    try {
      await apiClient.post('/client/2fa/enable', { code: otp })
      setMsg('2FA enabled')
    } catch (e: any) {
      setMsg('Invalid OTP')
    }
  }

  return (
    <div style={{ padding: '2rem' }}>
      {qr ? (
        <div>
          <img src={qr} alt="QR" />
          <input value={otp} onChange={e => setOtp(e.target.value)} placeholder="OTP" />
          <button onClick={enable}>Enable</button>
        </div>
      ) : (
        <button onClick={setup}>Setup 2FA</button>
      )}
      {msg && <p>{msg}</p>}
    </div>
  )
}