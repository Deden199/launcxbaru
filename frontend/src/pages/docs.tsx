// File: src/pages/client/integration.tsx
'use client'
import { NextPage } from 'next'
import React from 'react'
import styles from './DocsPage.module.css'

/**
 * Dokumentasi lengkap integrasi Launcx API untuk partner‑client.
 * Mendukung environment Production & Staging.
 * Menjelaskan header otentikasi, flow transaksi, callback, dan dashboard.
 */

const IntegrationDocs: NextPage & { disableLayout?: boolean } = () => (
  <main className={styles.container}>
    {/* ─────────────────────────────────────────────── TITLE */}
    <h1 className={styles.heading1}>Launcx API Integration Guide</h1>

    {/* ──────────────────────────────── ENVIRONMENT & BASE URL */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>Environment & Base URLs</h2>
      <ul className={styles.list}>
        <li><strong>Production:</strong> <code>https://launcx.com/api/v1</code></li>
        <li><strong>Staging:</strong> <code>https://staging.launcx.com/api/v1</code></li>
      </ul>
      <p className={styles.bodyText}>
        Gunakan base URL sesuai environment Anda. Semua endpoint di bawah <code>/api/v1</code>.
      </p>
    </section>

    {/* ─────────────────────────────────── 1. Authentication */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>1. Authentication</h2>
      <p className={styles.bodyText}>
        Setiap request ke <code>/api/v1/*</code> <strong>wajib</strong> menyertakan header:
      </p>
      <ul className={styles.list}>
        <li><code>Content-Type: application/json</code></li>
        <li><code>x-api-key: &lt;YOUR_API_KEY&gt;</code></li>
        <li><code>x-timestamp: &lt;Unix TS ms&gt;</code> (ditolak jika selisih &gt;5 menit)</li>
      </ul>
      <pre className={styles.codeBlock}><code>{`import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NODE_ENV === 'production'
    ? 'https://launcx.com/api/v1'
    : 'https://staging.launcx.com/api/v1',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.LAUNCX_API_KEY!,
  },
})

api.interceptors.request.use(cfg => {
  cfg.headers['x-timestamp'] = Date.now().toString()
  return cfg
})

export default api`}</code></pre>
    </section>

    {/* ─────────────────────────────────── 2. Create Transaction / Order */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>2. Create Transaction / Order</h2>
      <p className={styles.bodyText}>
        Endpoint: <code>POST /payments</code> mendukung dua flow:
      </p>
      <ol className={styles.list}>
        <li><strong>Embed Flow</strong> – respon JSON berisi <code>qrPayload</code>.</li>
        <li><strong>Redirect Flow</strong> – respon <code>303 See Other</code> dengan header <code>Location</code>.</li>
      </ol>

      {/* Embed Flow */}
      <h3 className={styles.heading3}>2.1 Embed Flow</h3>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/payments
Headers: (lihat Authentication)
Body:
{
  "price": 50000,
  "playerId": "gamer_foo",
  "flow": "embed"    // default embed jika dihilangkan
}`}</code></pre>
      <p className={styles.bodyText}>Response <code>201 Created</code>:</p>
      <pre className={styles.codeBlock}><code>{`{
  "success": true,
  "data": {
    "orderId": "685s6eb9263c75af53ba84b1",
    "checkoutUrl": "https://payment.launcx.com/order/{orderId}",
    "qrPayload": "0002010102122667...47B8",
    "playerId": "gamer_foo",
    "totalAmount": 50000
  }
}`}</code></pre>

      {/* Redirect Flow */}
      <h3 className={styles.heading3}>2.2 Redirect Flow</h3>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/payments
Headers: (sama)
Body:
{
  "price": 50000,
  "playerId": "gamer_foo",
  "flow": "redirect"
}`}</code></pre>
      <p className={styles.bodyText}>Response <code>303 See Other</code>:</p>
      <pre className={styles.codeBlock}><code>{`HTTP/1.1 303 See Other
Location: https://payment.launcx.com/order/685e6f36263c75af53ba84b3`}</code></pre>

      <h4 className={styles.heading3}>Contoh cURL (Embed)</h4>
      <pre className={styles.codeBlock}><code>{`curl -i -X POST https://launcx.com/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -H "x-timestamp: $(($(date +%s)*1000))" \
  -d '{
        "price": 50000,
        "playerId": "gamer_foo"
      }'`}</code></pre>

      <h4 className={styles.heading3}>Contoh Axios (Redirect)</h4>
      <pre className={styles.codeBlock}><code>{`import api from '@/lib/api'

async function payRedirect() {
  const res = await api.post('/payments', {
    price: 50000,
    playerId: 'gamer_foo',
    flow: 'redirect',
  }, { validateStatus: () => true })

  if (res.status === 303 && res.headers.location) {
    window.location.href = res.headers.location
  } else {
    console.error('Unexpected response', res.data)
  }
}`}</code></pre>
    </section>

    {/* Register Callback URL */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>3. Register Callback URL</h2>
      <p className={styles.bodyText}>
        Daftarkan endpoint di Dashboard Launcx sebelum menerima callback.
      </p>
      <pre className={styles.codeBlock}><code>{`POST /client/callback-url
Authorization: Bearer <YOUR_JWT_TOKEN>
Content-Type: application/json

Body:
{
  "url": "https://your-server.com/api/transactions/callback"
}`}</code></pre>
      <p className={styles.bodyText}>
        Setelah sukses, Anda akan melihat <strong>Callback Secret</strong> di halaman Callback Settings.
        Simpan secret ini untuk memverifikasi signature.
      </p>
    </section>

    {/* Handle Callback */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>4. Handle Callback</h2>
      <p className={styles.bodyText}>
        Launcx akan POST ke URL Anda saat transaksi <strong>SUCCESS</strong> atau <strong>DONE</strong>.
      </p>
      <pre className={styles.codeBlock}><code>{`{
  "orderId": "685d4578f2745f068c635f17",
  "status": "SUCCESS",
  "amount": 50000,
  "timestamp": "2025-06-26T14:30:00Z",
  "nonce": "uuid-v4"
}`}</code></pre>
      <p className={styles.bodyText}>
        Signature HMAC-SHA256 di header <code>X-Callback-Signature</code>. Verifikasi:
      </p>
      <pre className={styles.codeBlock}><code>{`import crypto from 'crypto'

function verifyCallback(body, signature, secret) {
  const payload = JSON.stringify(body)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return signature === expected
}`}</code></pre>

      {/* Staging: Simulate Callback */}
      <h3 className={styles.heading3}>4.1 Simulate Callback (Staging Only)</h3>
      <p className={styles.bodyText}>
        Di environment staging, Anda dapat mengetes callback sebelum integrasi riil:
      </p>
      <pre className={styles.codeBlock}><code>{`API_KEY="5ef7b50d-e4db..."
ORDER_ID="685fe5b5153faa0cc6e1b498"

curl -i -X POST https://staging.launcx.com/api/v1/simulate-callback \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Timestamp: $(date +%s000)" \
  -d '{
    "orderId":"'$ORDER_ID'",
    "amount":1000,
    "method":"qris"
  }'`}</code></pre>
      <p className={styles.bodyText}>
        Response <code>200 OK</code>:
      </p>
      <pre className={styles.codeBlock}><code>{`{"success":true,"message":"Simulasi callback berhasil"}`}</code></pre>
      <p className={styles.bodyText}>
        Pastikan telah mendaftarkan Callback URL di Dashboard sebelum simulasi.
      </p>
    </section>

    {/* Client Dashboard & Withdraw */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>5. Client Dashboard & Withdraw</h2>
      <p className={styles.bodyText}>
        Akses Dashboard di <code>/client/dashboard</code>. Fitur:
      </p>
      <ul className={styles.list}>
        <li><strong>Saldo Aktif</strong>: Saldo terkini.</li>
        <li><strong>Total Transaksi</strong>: Ringkasan transaksi.</li>
        <li><strong>Riwayat Transaksi</strong>: Daftar semua transaksi.</li>
        <li><strong>Callback Settings</strong>: Daftar URL + Callback Secret.</li>
        <li><strong>Withdraw</strong>: Ajukan penarikan dana.</li>
      </ul>
      <pre className={styles.codeBlock}><code>{`POST /client/dashboard/withdraw
Content-Type: application/json

{
  "bank_code": "bca",
  "account_number": "1234567890",
  "amount": 25000
}`}</code></pre>
    </section>

    {/* End-to-End Flow */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>6. End-to-End Flow</h2>
      <ol className={styles.list}>
        <li>Login & dapatkan <code>apiKey</code>.</li>
        <li>Register Callback URL di Dashboard.</li>
        <li>Create Order (<code>/payments</code>).</li>
        <li>Redirect user ke Checkout URL atau render QR embed.</li>
        <li>Terima Callback, verifikasi signature.</li>
        <li>Tampilkan status & monitor saldo di Client Dashboard.</li>
        <li>Ajukan Withdraw saat diperlukan.</li>
      </ol>
    </section>
  </main>
)

IntegrationDocs.disableLayout = true
export default IntegrationDocs
