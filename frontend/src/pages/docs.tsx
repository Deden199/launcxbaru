// File: src/pages/client/integration.tsx
'use client'
import { NextPage } from 'next'
import React from 'react'
import styles from './DocsPage.module.css'

/**
 * Complete documentation of the Launcx API integration for partner clients.
 * Supports Production & Staging environments.
 * Explains authentication headers, transaction flow, callbacks, and dashboard.
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
        Use the base URL according to your environment. All endpoints are under <code>/api/v1</code>.
      </p>
    </section>

    {/* ─────────────────────────────────── 1. Authentication */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>1. Authentication</h2>
      <p className={styles.bodyText}>
        Every request to <code>/api/v1/*</code> <strong>must</strong> include the following headers:
      </p>
      <ul className={styles.list}>
        <li><code>Content-Type: application/json</code></li>
        <li><code>x-api-key: &lt;YOUR_API_KEY&gt;</code></li>
        <li><code>x-timestamp: &lt;Unix TS ms&gt;</code> (rejected if difference &gt; 5 minutes)</li>
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
        Endpoint: <code>POST /payments</code> supports two flows:
      </p>
      <ol className={styles.list}>
        <li><strong>Embed Flow</strong> – JSON response containing <code>qrPayload</code>.</li>
        <li><strong>Redirect Flow</strong> – <code>303 See Other</code> response with a <code>Location</code> header.</li>
      </ol>

      {/* Embed Flow */}
      <h3 className={styles.heading3}>2.1 Embed Flow</h3>
      <pre className={styles.codeBlock}><code>{`POST /api/v1/payments
Headers: (see Authentication)
Body:
{
  "price": 50000,
  "playerId": "gamer_foo",
  "flow": "embed"    // defaults to embed if omitted
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
Headers: (same as above)
Body:
{
  "price": 50000,
  "playerId": "gamer_foo",
  "flow": "redirect"
}`}</code></pre>
      <p className={styles.bodyText}>Response <code>303 See Other</code>:</p>
      <pre className={styles.codeBlock}><code>{`HTTP/1.1 303 See Other
Location: https://payment.launcx.com/order/685e6f36263c75af53ba84b3`}</code></pre>

      <h4 className={styles.heading3}>cURL Example (Embed)</h4>
      <pre className={styles.codeBlock}><code>{`curl -i -X POST https://launcx.com/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -H "x-timestamp: $(($(date +%s)*1000))" \
  -d '{
        "price": 50000,
        "playerId": "gamer_foo"
      }'`}</code></pre>

      <h4 className={styles.heading3}>Axios Example (Redirect)</h4>
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

    {/* ─────────────────────────────────── 5.1 Retry Transaction Callback */}
    <section className={styles.section}>
      <h3 className={styles.heading3}>5.1 Retry Transaction Callback</h3>
      <p className={styles.bodyText}>
        If the last callback failed, retry with:
      </p>
      <pre className={styles.codeBlock}><code>{`POST /client/callbacks/{orderId}/retry`}</code></pre>
      <p className={styles.bodyText}>
        The server will load the last callback payload, calculate a new signature, and then POST back to your <code>callbackUrl</code>.
      </p>
    </section>

    {/* ─────────────────────────────────── 3. Register Callback URL */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>3. Register Callback URL</h2>
      <p className={styles.bodyText}>
        Register your endpoint in the Launcx Dashboard before receiving callbacks.
      </p>
      <pre className={styles.codeBlock}><code>{`POST /client/callback-url
Authorization: Bearer <YOUR_JWT_TOKEN>
Content-Type: application/json

Body:
{
  "url": "https://your-server.com/api/transactions/callback"
}`}</code></pre>
      <p className={styles.bodyText}>
        After success, you will see the <strong>Callback Secret</strong> on the Callback Settings page. Save this secret to verify signatures.
      </p>
    </section>

    {/* ─────────────────────────────────── 4. Handle Callback */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>4. Handle Callback</h2>
      <p className={styles.bodyText}>
        Launcx will POST to your URL when the transaction is <strong>SUCCESS</strong> or <strong>DONE</strong>.
      </p>
      <pre className={styles.codeBlock}><code>{`{
  "orderId": "685d4578f2745f068c635f17",
  "status": "PAID",
  "settlementStatus": "PENDING",
  "grossAmount": 50000,
  "feeLauncx": 2500,
  "netAmount": 47500,
  "qrPayload": "qris://0123456789",
  "timestamp": "2025-06-26T14:30:00Z",
  "nonce": "uuid-v4"
}`}</code></pre>
      <p className={styles.bodyText}>
        The HMAC-SHA256 signature is in the <code>X-Callback-Signature</code> header. Verify it as follows:
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
        In the staging environment, you can test callbacks before real integration:
      </p>
      <pre className={styles.codeBlock}><code>{`API_KEY="46c58b1b-3e3f-488a-87e6-0446356c4f1b"
ORDER_ID="687e4adb92ca2a2b070c590b"

curl -i -X POST https://staging.launcx.com/api/v1/simulate-callback \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Timestamp: $(date +%s000)" \
  -d '{
    "ref_id": "'"$ORDER_ID"'",
    "amount": 1000,
    "net_amount": 1000,
    "method": "qris",
    "status": "SUCCESS",
    "total_fee": 0,
    "qr_string": "qris",
    "settlement_status": "PENDING",
    "updated_at": {
      "value": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
    },
    "expires_at": {
      "value": "'"$(date -u -d "+30 minutes" +"%Y-%m-%dT%H:%M:%SZ")"'"
    }
  }'`}</code></pre>
      <p className={styles.bodyText}>
        <code>200 OK</code> response:
      </p>
      <pre className={styles.codeBlock}><code>{`{"success":true,"message":"ok"}`}</code></pre>
      <p className={styles.bodyText}>
        Ensure you have registered the Callback URL in the Dashboard before simulation.
      </p>
    </section>

    {/* ─────────────────────────────────── 5. Client Dashboard & Withdraw */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>5. Client Dashboard & Withdraw</h2>
      <p className={styles.bodyText}>
        Access the Dashboard at <code>/client/dashboard</code>. Features:
      </p>
      <ul className={styles.list}>
        <li><strong>Active Balance</strong>: Current balance.</li>
        <li><strong>Total Transactions</strong>: Transaction summary.</li>
        <li><strong>Transaction History</strong>: List of all transactions.</li>
        <li><strong>Callback Settings</strong>: List of URLs + Callback Secrets.</li>
        <li><strong>Withdraw</strong>: Submit a withdrawal request.</li>
      </ul>
    </section>

    {/* ─────────────────────────────────── 6. End-to-End Flow */}
    <section className={styles.section}>
      <h2 className={styles.heading2}>6. End-to-End Flow</h2>
      <ol className={styles.list}>
        <li>Login & obtain <code>apiKey</code>.</li>
        <li>Register Callback URL in the Dashboard.</li>
        <li>Create Order (<code>/payments</code>).</li>
        <li>Redirect user to Checkout URL or render embedded QR.</li>
        <li>Receive Callback, verify signature.</li>
        <li>Display status & monitor balance in Client Dashboard.</li>
        <li>Submit a withdrawal when needed.</li>
      </ol>
    </section>
  </main>
)

IntegrationDocs.disableLayout = true
export default IntegrationDocs
