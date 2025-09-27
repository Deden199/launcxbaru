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
          --page-bg: #0a0a0a;
          --surface: #171717;
          --surface-subtle: #262626;
          --surface-hover: #1f1f1f;
          --surface-elevated: #1c1c1c;
          --text-primary: #f4f4f5;
          --text-secondary: #a3a3a3;
          --border: #262626;
          --border-strong: #404040;
          --accent: #38bdf8;
          --accent-strong: #0ea5e9;
          --danger: #f87171;
          --danger-strong: #ef4444;
        }
        :global(body) {
          background: var(--page-bg);
          color: var(--text-primary);
        }
        .container {
          width: min(960px, 100%);
          max-width: 960px;
          margin: 0 auto;
          padding: 2.5rem 1.5rem 3rem;
          min-height: 100vh;
          background: var(--page-bg);
          color: var(--text-primary);
          font-family: 'Inter', 'Segoe UI', sans-serif;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }
        .title {
          font-size: 1.5rem;
          margin: 0;
          font-weight: 600;
        }
        .add-btn {
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
          color: var(--text-primary);
          border: 1px solid var(--accent-strong);
          padding: 0.65rem 1.2rem;
          border-radius: 0.75rem;
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 600;
          transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
        }
        .add-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }
        .add-btn:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 24px -12px rgba(56, 189, 248, 0.6);
        }
        .add-btn:focus-visible {
          outline: 2px solid var(--accent-strong);
          outline-offset: 3px;
        }
        .table-wrapper {
          margin-top: 1.75rem;
          overflow-x: auto;
          background: var(--surface);
          border-radius: 1rem;
          border: 1px solid var(--border);
          box-shadow: 0 30px 60px -45px rgba(15, 15, 15, 0.9);
        }
        .providers {
          width: 100%;
          border-collapse: collapse;
          min-width: 720px;
        }
        .providers th,
        .providers td {
          padding: 0.85rem 1.25rem;
          border-bottom: 1px solid var(--border);
          text-align: left;
          color: var(--text-primary);
        }
        .providers th {
          background: var(--surface-subtle);
          font-weight: 600;
          color: var(--text-secondary);
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .providers tbody tr {
          background: transparent;
          transition: background 0.15s ease, transform 0.15s ease;
        }
        .providers tbody tr:nth-child(even) {
          background: rgba(38, 38, 38, 0.5);
        }
        .providers tbody tr:hover {
          background: var(--surface-hover);
        }
        .providers tbody tr:focus-within {
          background: var(--surface-hover);
          outline: 1px solid var(--accent-strong);
        }
        .cell-bold {
          font-weight: 600;
        }
        .no-data {
          text-align: center;
          padding: 2.5rem 1rem;
          color: var(--text-secondary);
          font-size: 0.95rem;
        }
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(10, 10, 10, 0.75);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
          animation: fadeIn 0.15s ease forwards;
        }
        .modal {
          width: min(720px, 100%);
          max-height: 90vh;
          overflow-y: auto;
          background: var(--surface-elevated);
          border-radius: 1rem;
          border: 1px solid var(--border-strong);
          padding: 1.75rem;
          box-shadow: 0 30px 70px -45px rgba(0, 0, 0, 0.9);
          animation: slideDown 0.2s ease forwards;
        }
        .modal-title {
          margin: 0 0 1.25rem;
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .error-banner {
          background: rgba(248, 113, 113, 0.12);
          border: 1px solid rgba(248, 113, 113, 0.5);
          color: #fecaca;
          padding: 0.75rem 1rem;
          border-radius: 0.75rem;
          margin-bottom: 1rem;
          text-align: center;
        }
        form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          background: var(--surface-subtle);
          padding: 0.85rem 1rem;
          border-radius: 0.75rem;
          border: 1px solid var(--border);
        }
        .form-group label {
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-secondary);
        }
        .form-group input,
        .form-group select {
          padding: 0.65rem 0.75rem;
          border-radius: 0.65rem;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-primary);
          font-size: 0.95rem;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .form-group input::placeholder,
        .form-group select::placeholder {
          color: var(--text-secondary);
        }
        .form-group input:focus-visible,
        .form-group select:focus-visible {
          outline: none;
          border-color: var(--accent-strong);
          box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.25);
        }
        .form-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }
        .checkbox-group {
          display: flex;
          gap: 1.5rem;
          padding: 0.5rem 0;
        }
        .checkbox-group label {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-secondary);
          font-size: 0.95rem;
        }
        .checkbox-group input[type='checkbox'] {
          width: 1.05rem;
          height: 1.05rem;
          accent-color: var(--accent-strong);
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          margin-top: 0.25rem;
        }
        .save-btn,
        .cancel-btn {
          border-radius: 0.75rem;
          padding: 0.65rem 1.2rem;
          font-weight: 600;
          border: 1px solid transparent;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        }
        .save-btn {
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
          color: var(--text-primary);
          border-color: rgba(14, 165, 233, 0.7);
        }
        .save-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 18px 32px -20px rgba(14, 165, 233, 0.8);
        }
        .save-btn:focus-visible {
          outline: 2px solid var(--accent-strong);
          outline-offset: 3px;
        }
        .cancel-btn {
          background: var(--surface);
          color: var(--text-secondary);
          border-color: var(--border);
        }
        .cancel-btn:hover {
          background: var(--surface-hover);
          color: var(--text-primary);
        }
        .cancel-btn:focus-visible {
          outline: 2px solid var(--border-strong);
          outline-offset: 3px;
        }
        @media (max-width: 640px) {
          .container {
            padding: 2rem 1rem 3rem;
          }
          .header {
            flex-direction: column;
            align-items: flex-start;
          }
          .add-btn {
            width: 100%;
            text-align: center;
          }
          .providers {
            min-width: 100%;
          }
          .modal {
            padding: 1.5rem;
          }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideDown {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

    </div>
  )
}
