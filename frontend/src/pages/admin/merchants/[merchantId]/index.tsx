import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'

type ProviderType = 'hilogate' | 'oy' | 'gidi' | 'ing1' | 'piro'

type HilogateEnv = 'sandbox' | 'production' | 'live'

type HilogateOyCredentials = {
  merchantId: string
  env: HilogateEnv
  secretKey: string
}

type GidiCredentials = {
  baseUrl: string
  credentialKey: string
  merchantId: string
  subMerchantId: string
}

type Ing1Credentials = {
  baseUrl: string
  email: string
  password: string
  productCode: string
  callbackUrl: string
  permanentToken: string
  merchantId: string
  apiVersion: string
}

type PiroCredentials = {
  merchantId: string
  storeId: string
  terminalId: string
  channel: string
  callbackUrl?: string
}

type ScheduleSetting = {
  weekday: boolean
  weekend: boolean
}

type RawProviderEntry = {
  id: string
  name: string
  provider: ProviderType
  credentials: any
  schedule: ScheduleSetting
}

type ProviderForm = {
  provider: ProviderType
  name: string
  credentials: HilogateOyCredentials | GidiCredentials | Ing1Credentials | PiroCredentials
  schedule: ScheduleSetting
}

type UseRouterLike = () => { query?: { merchantId?: string } }

type ApiClient = {
  get: typeof api.get
  post: typeof api.post
  patch: typeof api.patch
  delete: typeof api.delete
}

export type PaymentProvidersPageProps = {
  apiClient?: ApiClient
  useRouterImpl?: UseRouterLike
  initialForm?: ProviderForm
  initialShowForm?: boolean
}

const allowedEnvs: HilogateEnv[] = ['sandbox', 'production', 'live']

const trimString = (value?: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const pickTrimmed = (...values: unknown[]) => {
  for (const value of values) {
    const str = trimString(value)
    if (str) return str
  }
  return ''
}

const ensureEnv = (value: string): HilogateEnv =>
  allowedEnvs.includes(value as HilogateEnv) ? (value as HilogateEnv) : 'sandbox'

function normalizeCredentialsForForm(
  provider: ProviderType,
  raw?: any
): HilogateOyCredentials | GidiCredentials | Ing1Credentials | PiroCredentials {
  const source = (raw ?? {}) as Record<string, unknown>

  if (provider === 'gidi') {
    return {
      baseUrl: pickTrimmed(source.baseUrl, source.base_url),
      credentialKey: pickTrimmed(source.credentialKey, source.credential_key),
      merchantId: pickTrimmed(source.merchantId, source.merchant_id),
      subMerchantId: pickTrimmed(source.subMerchantId, source.sub_merchant_id),
    }
  }

  if (provider === 'ing1') {
    return {
      baseUrl: pickTrimmed(source.baseUrl, source.base_url),
      email: pickTrimmed(source.email),
      password: pickTrimmed(source.password),
      productCode: pickTrimmed(source.productCode, source.product_code),
      callbackUrl: pickTrimmed(source.callbackUrl, source.callback_url, source.return_url),
      permanentToken: pickTrimmed(source.permanentToken, source.permanent_token, source.token),
      merchantId: pickTrimmed(source.merchantId, source.merchant_id),
      apiVersion: pickTrimmed(source.apiVersion, source.api_version, source.version),
    }
  }

  if (provider === 'piro') {
    return {
      merchantId: pickTrimmed(source.merchantId, source.merchant_id),
      storeId: pickTrimmed(source.storeId, source.store_id),
      terminalId: pickTrimmed(source.terminalId, source.terminal_id),
      channel: pickTrimmed(source.channel),
      callbackUrl: optionalField(pickTrimmed(source.callbackUrl, source.callback_url)),
    }
  }

  return {
    merchantId: pickTrimmed(source.merchantId, source.merchant_id),
    env: ensureEnv(pickTrimmed(source.env, source.environment) || 'sandbox'),
    secretKey: pickTrimmed(source.secretKey, source.secret_key),
  }
}

const createEmptyForm = (provider: ProviderType = 'hilogate'): ProviderForm => ({
  provider,
  name: '',
  credentials: normalizeCredentialsForForm(provider),
  schedule: { weekday: true, weekend: false },
})

const parseSchedule = (schedule?: Partial<ScheduleSetting> | null): ScheduleSetting => ({
  weekday: Boolean(schedule?.weekday),
  weekend: Boolean(schedule?.weekend),
})

const optionalField = (value?: string) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const displayOrDash = (value?: unknown) => {
  const str = trimString(value)
  return str || '–'
}

const resolvePrimaryCredential = (entry: RawProviderEntry) => {
  const creds = (entry.credentials ?? {}) as Record<string, unknown>

  if (entry.provider === 'hilogate' || entry.provider === 'oy') {
    return displayOrDash(creds.merchantId ?? creds.merchant_id)
  }

  if (entry.provider === 'gidi' || entry.provider === 'ing1') {
    return displayOrDash(creds.baseUrl ?? creds.base_url)
  }

  if (entry.provider === 'piro') {
    return displayOrDash(creds.merchantId ?? creds.merchant_id)
  }

  return '–'
}

const resolveSecondaryInfo = (entry: RawProviderEntry) => {
  const creds = (entry.credentials ?? {}) as Record<string, unknown>

  if (entry.provider === 'hilogate' || entry.provider === 'oy') {
    return displayOrDash(creds.env ?? creds.environment)
  }

  if (entry.provider === 'gidi') {
    return displayOrDash(creds.credentialKey ?? creds.credential_key)
  }

  if (entry.provider === 'ing1') {
    return displayOrDash(creds.email)
  }

  if (entry.provider === 'piro') {
    const store = trimString(creds.storeId ?? creds.store_id)
    const terminal = trimString(creds.terminalId ?? creds.terminal_id)
    const channel = trimString(creds.channel)
    const parts: string[] = []
    if (store) parts.push(`Store: ${store}`)
    if (terminal) parts.push(`Terminal: ${terminal}`)
    if (channel) parts.push(`Channel: ${channel}`)
    return parts.length ? parts.join(' • ') : '–'
  }

  return '–'
}

export function PaymentProvidersPageView({
  apiClient = api,
  useRouterImpl = useRouter,
  initialForm,
  initialShowForm,
}: PaymentProvidersPageProps = {}) {
  const router = useRouterImpl()
  const { merchantId } = router.query as { merchantId?: string }
  const [editId, setEditId] = useState<string | null>(null)
  const [merchant, setMerchant] = useState<{ name: string } | null>(null)
  const [entries, setEntries] = useState<RawProviderEntry[]>([])
  const [showForm, setShowForm] = useState(initialShowForm ?? false)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState<ProviderForm>(() => initialForm ?? createEmptyForm())

  useEffect(() => {
    if (merchantId) {
      apiClient.get<{ name: string }>(`/admin/merchants/${merchantId}`)
        .then(res => setMerchant(res.data))
        .catch(() => console.error('Gagal mengambil data merchant'))
      fetchEntries()
    }
  }, [merchantId])

  async function fetchEntries() {
    try {
      const res = await apiClient.get<RawProviderEntry[]>(`/admin/merchants/${merchantId}/pg`)
      setEntries(res.data)
    } catch (err) {
      console.error('Fetch providers error', err)
    }
  }

  async function saveEntry() {
    if (!merchantId) return
    setErrorMsg('')

    const provider = form.provider
    let payloadCreds: Record<string, any> = {}

    if (provider === 'gidi') {
      const creds = form.credentials as GidiCredentials
      const baseUrl = creds.baseUrl.trim()
      const credentialKey = creds.credentialKey.trim()

      if (!baseUrl || !credentialKey) {
        setErrorMsg('Base URL dan Credential Key wajib diisi untuk Gidi.')
        return
      }

      payloadCreds = {
        baseUrl,
        credentialKey,
      }

      const merchantOpt = optionalField(creds.merchantId)
      const subMerchantOpt = optionalField(creds.subMerchantId)
      if (merchantOpt) payloadCreds.merchantId = merchantOpt
      if (subMerchantOpt) payloadCreds.subMerchantId = subMerchantOpt
    } else if (provider === 'piro') {
      const creds = form.credentials as PiroCredentials
      const merchantIdValue = creds.merchantId.trim()
      const storeIdValue = creds.storeId.trim()
      const terminalIdValue = creds.terminalId.trim()
      const channelValue = creds.channel.trim()

      if (!merchantIdValue || !storeIdValue || !terminalIdValue || !channelValue) {
        setErrorMsg('Merchant ID, Store ID, Terminal ID, dan Channel wajib diisi untuk Piro.')
        return
      }

      payloadCreds = {
        merchantId: merchantIdValue,
        storeId: storeIdValue,
        terminalId: terminalIdValue,
        channel: channelValue,
      }

      const callbackUrl = optionalField(creds.callbackUrl)
      if (callbackUrl) payloadCreds.callbackUrl = callbackUrl
    } else if (provider === 'ing1') {
      const creds = form.credentials as Ing1Credentials
      const baseUrl = creds.baseUrl.trim()
      const email = creds.email.trim()
      const password = creds.password.trim()

      if (!baseUrl || !email || !password) {
        setErrorMsg('Base URL, Email, dan Password wajib diisi untuk ING1.')
        return
      }

      payloadCreds = { baseUrl, email, password }

      const productCode = optionalField(creds.productCode)
      const callbackUrl = optionalField(creds.callbackUrl)
      const permanentToken = optionalField(creds.permanentToken)
      const merchantIng1 = optionalField(creds.merchantId)
      const apiVersion = optionalField(creds.apiVersion)

      if (productCode) payloadCreds.productCode = productCode
      if (callbackUrl) payloadCreds.callbackUrl = callbackUrl
      if (permanentToken) payloadCreds.permanentToken = permanentToken
      if (merchantIng1) payloadCreds.merchantId = merchantIng1
      if (apiVersion) payloadCreds.apiVersion = apiVersion
    } else {
      const creds = form.credentials as HilogateOyCredentials
      const merchantIdValue = creds.merchantId.trim()
      const secretKeyValue = creds.secretKey.trim()
      const envValue = allowedEnvs.includes(creds.env) ? creds.env : 'sandbox'

      if (!merchantIdValue || !secretKeyValue) {
        setErrorMsg('Merchant ID dan Secret Key wajib diisi.')
        return
      }

      payloadCreds = {
        merchantId: merchantIdValue,
        env: envValue,
        secretKey: secretKeyValue,
      }
    }

    const payload = {
      provider,
      name: form.name?.trim?.() ?? '',
      credentials: payloadCreds,
      schedule: {
        weekday: !!form.schedule.weekday,
        weekend: !!form.schedule.weekend,
      },
    }

    try {
      if (editId) {
        await apiClient.patch(`/admin/merchants/${merchantId}/pg/${editId}`, payload)
      } else {
        await apiClient.post(`/admin/merchants/${merchantId}/pg`, payload)
      }
      setShowForm(false)
      setEditId(null)
      setForm(createEmptyForm(provider))
      fetchEntries()
    } catch (err: any) {
      setErrorMsg(err.response?.data.error || 'Gagal menyimpan, coba lagi.')
    }
  }

  function startEdit(entry: RawProviderEntry) {
    setForm({
      provider: entry.provider,
      name: entry.name ?? '',
      credentials: normalizeCredentialsForForm(entry.provider, entry.credentials),
      schedule: parseSchedule(entry.schedule),
    })
    setEditId(entry.id)
    setErrorMsg('')
    setShowForm(true)
  }

  async function deleteEntry(subId: string) {
    if (!merchantId) return
    if (!confirm('Yakin ingin menghapus koneksi ini?')) return

    try {
      await apiClient.delete(`/admin/merchants/${merchantId}/pg/${subId}`)
      fetchEntries()
    } catch (err) {
      console.error('Delete provider error', err)
      alert('Gagal menghapus koneksi.')
    }
  }

  return (
    <div className="container">
      <header className="header">
        <h2 className="title">
          {merchant ? `Sub: ${merchant.name}` : 'Memuat data merchant...'}
        </h2>
        <button
          className="add-btn"
          onClick={() => {
            setErrorMsg('')
            setEditId(null)
            setForm(createEmptyForm())
            setShowForm(true)
          }}
          disabled={!merchant}
        >
          + Tambah Provider
        </button>
      </header>

      <div className="table-wrapper">
        <table className="providers">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Name</th>
              <th>Primary Credential</th>
              <th>Additional Info</th>
              <th>Weekday</th>
              <th>Weekend</th>
              {/* use client */}
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td className="cell-bold">{e.provider}</td>
                <td className="cell-bold">{e.name}</td>
                <td>{resolvePrimaryCredential(e)}</td>
                <td>{resolveSecondaryInfo(e)}</td>
                <td>{e.schedule.weekday ? '✔' : '–'}</td>
                <td>{e.schedule.weekend ? '✔' : '–'}</td>
                {/* use client */}
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="no-data">
                  Belum ada koneksi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="overlay" onClick={() => { setShowForm(false); setEditId(null) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editId ? 'Edit Provider' : 'Tambah Provider Baru'}</h3>
            {errorMsg && <div className="error-banner">{errorMsg}</div>}
            <form>
              <div className="form-group">
                <label>Provider</label>
                <select
                  value={form.provider}
                  onChange={e => {
                    const provider = e.target.value as ProviderType
                    setForm(prev => ({
                      ...prev,
                      provider,
                      credentials: normalizeCredentialsForForm(provider),
                    }))
                  }}
                >
                  <option value="hilogate">Hilogate</option>
                  <option value="oy">OY</option>
                  <option value="gidi">Gidi</option>
                  <option value="ing1">ING1 (Billers)</option>
                  <option value="piro">Piro</option>
                </select>
              </div>
              <div className="form-group">
                <label>Name</label>
                <input type="text" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              {(form.provider === 'hilogate' || form.provider === 'oy') && (
                <>
                  <div className="form-group">
                    <label>Environment</label>
                    <select
                      value={(form.credentials as HilogateOyCredentials)?.env}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as HilogateOyCredentials),
                            env: e.target.value as HilogateEnv,
                          },
                        }))
                      }
                    >
                      <option value="sandbox">Sandbox</option>
                      <option value="production">Production</option>
                      <option value="live">Live</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Merchant ID</label>
                    <input
                      type="text"
                      value={(form.credentials as HilogateOyCredentials)?.merchantId || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as HilogateOyCredentials),
                            merchantId: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Secret Key</label>
                    <input
                      type="text"
                      value={(form.credentials as HilogateOyCredentials)?.secretKey || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as HilogateOyCredentials),
                            secretKey: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </>
              )}

              {form.provider === 'piro' && (
                <div className="form-grid">
                  <div className="form-group">
                    <label>Merchant ID</label>
                    <input
                      type="text"
                      value={(form.credentials as PiroCredentials)?.merchantId || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as PiroCredentials),
                            merchantId: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Store ID</label>
                    <input
                      type="text"
                      value={(form.credentials as PiroCredentials)?.storeId || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as PiroCredentials),
                            storeId: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Terminal ID</label>
                    <input
                      type="text"
                      value={(form.credentials as PiroCredentials)?.terminalId || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as PiroCredentials),
                            terminalId: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Channel</label>
                    <input
                      type="text"
                      value={(form.credentials as PiroCredentials)?.channel || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as PiroCredentials),
                            channel: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Callback URL (opsional)</label>
                    <input
                      type="url"
                      value={(form.credentials as PiroCredentials)?.callbackUrl || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as PiroCredentials),
                            callbackUrl: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {form.provider === 'ing1' && (
                <div className="form-grid">
                  <div className="form-group">
                    <label>Base URL</label>
                    <input
                      type="url"
                      value={(form.credentials as Ing1Credentials)?.baseUrl || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as Ing1Credentials),
                            baseUrl: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email"
                      value={(form.credentials as Ing1Credentials)?.email || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as Ing1Credentials),
                            email: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Password</label>
                    <input
                      type="password"
                      value={(form.credentials as Ing1Credentials)?.password || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as Ing1Credentials),
                            password: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Default Product Code (opsional)</label>
                    <input
                      type="text"
                      value={(form.credentials as Ing1Credentials)?.productCode || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as Ing1Credentials),
                            productCode: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Callback URL (opsional)</label>
                    <input
                      type="url"
                      value={(form.credentials as Ing1Credentials)?.callbackUrl || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as Ing1Credentials),
                            callbackUrl: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Permanent Token (opsional)</label>
                    <input
                      type="text"
                      value={(form.credentials as Ing1Credentials)?.permanentToken || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as Ing1Credentials),
                            permanentToken: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Merchant ID Billers (opsional)</label>
                    <input
                      type="text"
                      value={(form.credentials as Ing1Credentials)?.merchantId || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as Ing1Credentials),
                            merchantId: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>API Version (opsional)</label>
                    <input
                      type="text"
                      value={(form.credentials as Ing1Credentials)?.apiVersion || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as Ing1Credentials),
                            apiVersion: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {form.provider === 'gidi' && (
                <div className="form-grid">
                  <div className="form-group">
                    <label>Base URL</label>
                    <input
                      type="text"
                      value={(form.credentials as GidiCredentials)?.baseUrl || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as GidiCredentials),
                            baseUrl: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Credential Key</label>
                    <input
                      type="text"
                      value={(form.credentials as GidiCredentials)?.credentialKey || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as GidiCredentials),
                            credentialKey: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Merchant ID (optional)</label>
                    <input
                      type="text"
                      value={(form.credentials as GidiCredentials)?.merchantId || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as GidiCredentials),
                            merchantId: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Sub Merchant ID (optional)</label>
                    <input
                      type="text"
                      value={(form.credentials as GidiCredentials)?.subMerchantId || ''}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          credentials: {
                            ...(f.credentials as GidiCredentials),
                            subMerchantId: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              )}
              <div className="checkbox-group">
                <label>
                  <input type="checkbox" checked={form.schedule?.weekday ?? false} onChange={e => setForm(f => ({ ...f, schedule: { ...f.schedule!, weekday: e.target.checked } }))} /> Weekday
                </label>
                <label>
                  <input type="checkbox" checked={form.schedule?.weekend ?? false} onChange={e => setForm(f => ({ ...f, schedule: { ...f.schedule!, weekend: e.target.checked } }))} /> Weekend
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="save-btn" onClick={saveEntry}>{editId ? 'Update' : 'Simpan'}</button>
                <button type="button" className="cancel-btn" onClick={() => { setShowForm(false); setEditId(null) }}>Batal</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        :root {
          --bg-light: #f0f4f8;
          --bg-white:rgb(37, 27, 150);
          --primary: #0d9488;
          --primary-hover: #0f766e;
          --danger: #e11d48;
          --danger-hover: #be123c;
          --text-main: #1f2937;
          --text-muted: #4b5563;
          --border: #d1d5db;
        }
        .container {
          max-width: 900px;
          margin: 2rem auto;
          padding: 1rem;
          background: var(--bg-light);
          border-radius: 12px;
          font-family: 'Segoe UI', sans-serif;
          color: var(--text-main);
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .title {
          font-size: 1.6rem;
          margin: 0;
        }
        .add-btn {
          background: var(--primary);
          color: var(--bg-white);
          border: none;
          padding: 0.7rem 1.3rem;
          border-radius: 10px;
          cursor: pointer;
          font-size: 1rem;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
          transition: background 0.3s, transform 0.2s;
        }
        .add-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .add-btn:hover:not(:disabled) {
          background: var(--primary-hover);
          transform: translateY(-2px);
        }
        .table-wrapper {
          margin-top: 1.5rem;
          overflow-x: auto;
          background: var(--bg-white);
          border-radius: 10px;
          box-shadow: 0 4px 12px rgba(21, 56, 171, 0.08);
        }
        .providers {
          width: 100%;
          border-collapse: collapse;
        }


        .providers th,
        .providers td {
          padding: 0.875rem 1.25rem;
          border-bottom: 1px solid var(--border);
        }
        .providers th {
          background: var(--bg-light);
          font-weight: 600;
          position: sticky;
          top: 0;
          color: var(--text-muted);
        }
        .providers tr:nth-child(even) {
          background: #fafafa;
        }
        .providers tr:hover {
          background: #fff;
        }
        .cell-bold {
          font-weight: 500;
        }
        .delete-btn {
          background: var(--danger);
          color: var(--bg-white);
          border: none;
          padding: 0.5rem 0.9rem;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.3s;
        }
        .delete-btn:hover {
          background: var(--danger-hover);
        }
                  .edit-btn {
          background: var(--danger);
          color: var(--bg-white);
          border: none;
          padding: 0.5rem 0.9rem;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.3s;
        }
        .edit-btn:hover {
          background: var(--danger-hover);
        }
        .no-data {
          text-align: center;
          padding: 2rem;
          color: var(--text-muted);
        }
.overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.6);  /* overlay gelap */
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

export default function PaymentProvidersPage() {
  return <PaymentProvidersPageView />
}

.modal {
  background: #ffffff;
  border-radius: 16px;
  padding: 1.5rem;                  /* sedikit dipadatkan */
  width: 380px;
  max-width: 100%;                  /* aman di layar kecil */
  max-height: 90vh;                /* batasi tinggi supaya nggak melewati viewport */
  overflow-y: auto;                /* scroll kalau isinya melebihi tinggi */
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25); /* sedikit lebih halus supaya tidak terlalu “berat” */
  border: 1px solid rgba(0, 0, 0, 0.08);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  gap: 0; /* gap diatur di dalam form, bukan di container utama */
}

/* Jika ingin header / footer tetap terlihat, bisa bungkus isi yang scrollable: */
.modal .content {
  overflow-y: auto;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Form di dalam modal */
.modal form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem; /* sedikit rapatkan antar field */
  margin: 0;    /* pastikan nggak ada margin ekstra */
}

/* Opsional: kecilkan spacing di layar sempit */
@media (max-height: 600px) {
  .modal {
    padding: 1rem;
    max-height: 85vh;
  }
  .modal form {
    gap: 0.5rem;
  }
}

/* Berikan latar dan border untuk tiap form‐group */
.form-group {
  background: var(--bg-white);
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
}

/* Buat input/select lebih kontras */
.form-group input,
.form-group select {
  background: #f9fafb;
  border: 1px solid var(--border);
  padding: 0.6rem;
  border-radius: 6px;
  width: 100%;
  font-size: 1rem;
  color: var(--text-main);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}
.form-grid .form-group {
  margin-bottom: 0;
}

        .modal-title {
          margin: 0 0 1rem;
          font-size: 1.3rem;
          color: var(--text-main);
        }
        .error-banner {
          background: #fee2e2;
          color: #991b1b;
          padding: 0.75rem;
          border-radius: 6px;
          margin-bottom: 1rem;
          text-align: center;
        }
        .form-group {
          margin-bottom: 1.2rem;
          display: flex;
          flex-direction: column;
        }
        .form-group label {
          font-size: 0.95rem;
          margin-bottom: 0.5rem;
          color: var(--text-muted);
        }
        .form-group input,
        .form-group select {
          padding: 0.7rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 1rem;
          color: var(--text-main);
        }
        .checkbox-group {
          display: flex;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }
        .checkbox-group label {
          font-size: 0.95rem;
          color: var(--text-muted);
          display: flex;
          align-items: center;
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
        }
        .save-btn {
          background: var(--primary);
          color: var(--bg-white);
          border: none;
          padding: 0.7rem 1.3rem;
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.3s;
        }
        .save-btn:hover {
          background: var(--primary-hover);
        }
        .cancel-btn {
          background: var(--border);
          color: var(--text-main);
          padding: 0.7rem 1.3rem;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.3s;
        }
        .cancel-btn:hover {
          background: #e5e7eb;
        }
        @keyframes fadeIn {
          from { opacity: 0 }
          to { opacity: 1 }
        }
        @keyframes slideDown {
          from { transform: translateY(-10px) }
          to { transform: translateY(0) }
        }
      `}</style>
    </div>
  )
}
