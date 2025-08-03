import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'

/** Credential types sesuai backend final */
type HilogateCred = {
  merchantId: string
  env: 'sandbox' | 'production'
  secretKey: string
}

type OyCred = {
  username: string
  apiKey: string
}

type GidiCred = {
  baseUrl: string
  credentialKey: string
  merchantId?: string
}

/** Provider entry shape */
export interface ProviderEntry {
  id: string
  name: string
  provider: 'hilogate' | 'oy' | 'gidi' | string
  credentials: HilogateCred | OyCred | GidiCred | Record<string, any>
  schedule: {
    weekday: boolean
    weekend: boolean
  }
}

type PartialEntry = Partial<ProviderEntry> & {
  credentials?: Partial<HilogateCred & OyCred & GidiCred>
}

const DEFAULT_SCHEDULE = { weekday: true, weekend: false }

const resetFormDefaults = (provider: string): PartialEntry => {
  if (provider === 'hilogate') {
    return {
      provider,
      name: '',
      credentials: { merchantId: '', env: 'sandbox', secretKey: '' },
      schedule: { ...DEFAULT_SCHEDULE },
    }
  }
  if (provider === 'oy') {
    return {
      provider,
      name: '',
      credentials: { username: '', apiKey: '' },
      schedule: { ...DEFAULT_SCHEDULE },
    }
  }
  if (provider === 'gidi') {
    return {
      provider,
      name: '',
      credentials: { baseUrl: '', credentialKey: '', merchantId: '' },
      schedule: { ...DEFAULT_SCHEDULE },
    }
  }
  return {
    provider,
    name: '',
    credentials: {},
    schedule: { ...DEFAULT_SCHEDULE },
  }
}

/** UI components */
const Spinner: React.FC = () => (
  <div className="spinner" aria-label="loading" />
)

const ProviderBadge: React.FC<{ provider: string }> = ({ provider }) => (
  <span className={`badge badge-${provider.toLowerCase()}`}>{provider.toUpperCase()}</span>
)

const CredentialSummary: React.FC<{ entry: ProviderEntry }> = ({ entry }) => {
  if (entry.provider === 'hilogate') {
    const creds = entry.credentials as HilogateCred
    return <span>MerchantID: {creds.merchantId || '-'}</span>
  }
  if (entry.provider === 'oy') {
    const creds = entry.credentials as OyCred
    return <span>Username: {creds.username || '-'}</span>
  }
  if (entry.provider === 'gidi') {
    const creds = entry.credentials as GidiCred
    return <span>{creds.merchantId ? `MerchantID: ${creds.merchantId}` : '-'}</span>
  }
  return <span>-</span>
}

const ScheduleIndicator: React.FC<{ weekday: boolean; weekend: boolean }> = ({ weekday, weekend }) => (
  <div className="schedule-indicator">
    <div className="dot-label">
      <div className={`dot ${weekday ? 'active' : ''}`} />
      <span className="label-text">Weekday</span>
    </div>
    <div className="dot-label">
      <div className={`dot ${weekend ? 'active' : ''}`} />
      <span className="label-text">Weekend</span>
    </div>
  </div>
)

export default function PaymentProvidersPage() {
  const router = useRouter()
  const { merchantId } = router.query as { merchantId?: string }
  const [editId, setEditId] = useState<string | null>(null)
  const [merchant, setMerchant] = useState<{ name: string } | null>(null)
  const [entries, setEntries] = useState<ProviderEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState<PartialEntry>(resetFormDefaults('hilogate'))
  const [loadingMerchant, setLoadingMerchant] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)

  const fetchEntries = useCallback(async () => {
    if (!merchantId) return
    setFetching(true)
    try {
      const res = await api.get<ProviderEntry[]>(`/admin/merchants/${merchantId}/pg`)
      setEntries(res.data)
    } catch (err) {
      console.error('Fetch providers error', err)
    } finally {
      setFetching(false)
    }
  }, [merchantId])

  useEffect(() => {
    if (!merchantId) return
    setLoadingMerchant(true)
    api
      .get<{ name: string }>(`/admin/merchants/${merchantId}`)
      .then(res => setMerchant(res.data))
      .catch(() => console.error('Gagal mengambil data merchant'))
      .finally(() => setLoadingMerchant(false))
    fetchEntries()
  }, [merchantId, fetchEntries])

  const startEdit = (entry: ProviderEntry) => {
    setForm(entry)
    setEditId(entry.id)
    setErrorMsg('')
    setShowForm(true)
  }

  const deleteEntry = async (subId: string) => {
    if (!merchantId) return
    if (!confirm('Yakin ingin menghapus koneksi ini?')) return
    try {
      await api.delete(`/admin/merchants/${merchantId}/pg/${subId}`)
      await fetchEntries()
    } catch (err) {
      console.error('Delete provider error', err)
      alert('Gagal menghapus koneksi.')
    }
  }

  const validateForm = (): string | null => {
    if (!form.provider || !form.name || !form.schedule) {
      return 'Provider, nama, dan schedule wajib diisi.'
    }
    if (form.provider === 'hilogate') {
      const creds = form.credentials as HilogateCred | undefined
      if (!creds?.merchantId || !creds.env || !creds.secretKey) {
        return 'Semua field Hilogate (merchantId, env, secretKey) harus diisi.'
      }
    } else if (form.provider === 'oy') {
      const creds = form.credentials as OyCred | undefined
      if (!creds?.username || !creds.apiKey) {
        return 'Semua field OY (username, apiKey) harus diisi.'
      }
    } else if (form.provider === 'gidi') {
      const creds = form.credentials as GidiCred | undefined
      if (!creds?.baseUrl || !creds.credentialKey) {
        return 'Semua field Gidi (baseUrl, credentialKey) harus diisi.'
      }
    } else {
      return 'Provider tidak dikenali.'
    }
    return null
  }

  const saveEntry = async () => {
    if (!merchantId) return
    setErrorMsg('')
    const validationError = validateForm()
    if (validationError) {
      setErrorMsg(validationError)
      return
    }

    const payload: any = {
      provider: form.provider,
      name: form.name,
      credentials: form.credentials,
      schedule: form.schedule,
    }

    setSaving(true)
    try {
      if (editId) {
        await api.patch(`/admin/merchants/${merchantId}/pg/${editId}`, payload)
      } else {
        await api.post(`/admin/merchants/${merchantId}/pg`, payload)
      }
      setShowForm(false)
      setEditId(null)
      await fetchEntries()
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.error || 'Gagal menyimpan, coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  const renderCredentialInputs = () => {
    const sharedField = (
      id: string,
      label: string,
      placeholder: string,
      value: string,
      onChange: (v: string) => void,
      type: 'text' | 'password' = 'text'
    ) => (
      <div className="form-field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="clean-input"
          autoComplete="off"
        />
      </div>
    )

    if (form.provider === 'hilogate') {
      const creds = (form.credentials || {}) as HilogateCred
      return (
        <div className="form-grid">
          <div className="field-pair">
            {sharedField(
              'hilogate-merchant',
              'Merchant ID',
              'Hilogate Merchant ID',
              creds.merchantId || '',
              v => setForm(f => ({ ...f, credentials: { ...(f.credentials as any), merchantId: v } }))
            )}
            <div className="form-field">
              <label htmlFor="hilogate-env">Environment</label>
              <select
                id="hilogate-env"
                value={creds.env || 'sandbox'}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    credentials: { ...(f.credentials as any), env: e.target.value },
                  }))
                }
                className="clean-select"
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </div>
          </div>
          {sharedField(
            'hilogate-secret',
            'Secret Key',
            'Hilogate Secret Key',
            (creds.secretKey as string) || '',
            v => setForm(f => ({ ...f, credentials: { ...(f.credentials as any), secretKey: v } }))
          )}
        </div>
      )
    }

    if (form.provider === 'oy') {
      const creds = (form.credentials || {}) as OyCred
      return (
        <div className="form-grid">
          {sharedField(
            'oy-username',
            'Username',
            'OY Username',
            creds.username || '',
            v => setForm(f => ({ ...f, credentials: { ...(f.credentials as any), username: v } }))
          )}
          {sharedField(
            'oy-apikey',
            'API Key',
            'OY API Key',
            creds.apiKey || '',
            v => setForm(f => ({ ...f, credentials: { ...(f.credentials as any), apiKey: v } }))
          )}
        </div>
      )
    }

    if (form.provider === 'gidi') {
      const creds = (form.credentials || {}) as GidiCred
      return (
        <div className="form-grid">
          {sharedField(
            'gidi-baseurl',
            'Base URL',
            'https://...',
            creds.baseUrl || '',
            v => setForm(f => ({ ...f, credentials: { ...(f.credentials as any), baseUrl: v } }))
          )}
          {sharedField(
            'gidi-credentialkey',
            'Credential Key',
            'Credential Key',
            creds.credentialKey || '',
            v => setForm(f => ({ ...f, credentials: { ...(f.credentials as any), credentialKey: v } }))
          )}
          {sharedField(
            'gidi-merchantid-optional',
            'Merchant ID (optional)',
            'Merchant ID',
            creds.merchantId || '',
            v => setForm(f => ({ ...f, credentials: { ...(f.credentials as any), merchantId: v } }))
          )}
        </div>
      )
    }

    return null
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="header">
        <div className="title-block">
          <div className="title">
            {loadingMerchant ? (
              <div className="inline-flex">
                <Spinner />
                <span className="ml8">Memuat merchant...</span>
              </div>
            ) : merchant ? (
              `Sub: ${merchant.name}`
            ) : (
              'Merchant tidak ditemukan'
            )}
          </div>
        </div>
        <div>
          <button
            className="btn primary"
            onClick={() => {
              setErrorMsg('')
              setEditId(null)
              setForm(resetFormDefaults('hilogate'))
              setShowForm(true)
            }}
            disabled={!merchant}
          >
            + Tambah Provider
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="section-title">Koneksi Payment Gateway</div>
          {fetching && (
            <div className="small-muted">
              <Spinner />
              <span className="ml4">Memperbarui...</span>
            </div>
          )}
        </div>
        <div className="table-wrapper">
          <table className="providers">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Name</th>
                <th>Credential</th>
                <th>Schedule</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td>
                    <ProviderBadge provider={e.provider} />
                  </td>
                  <td className="font-medium">{e.name}</td>
                  <td>
                    <CredentialSummary entry={e} />
                  </td>
                  <td>
                    <ScheduleIndicator weekday={e.schedule.weekday} weekend={e.schedule.weekend} />
                  </td>
                  <td className="actions">
                    <button className="btn small neutral" onClick={() => startEdit(e)}>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => deleteEntry(e.id)}>
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    Belum ada koneksi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Form */}
      {showForm && (
        <div
          className="modal-backdrop"
          aria-modal="true"
          role="dialog"
          onClick={() => {
            if (!saving) {
              setShowForm(false)
              setEditId(null)
            }
          }}
        >
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{editId ? 'Edit Provider' : 'Tambah Provider Baru'}</div>
              <button
                aria-label="Close"
                className="close"
                onClick={() => {
                  if (!saving) {
                    setShowForm(false)
                    setEditId(null)
                  }
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {errorMsg && (
                <div className="banner error">
                  <div>{errorMsg}</div>
                  <button className="dismiss" onClick={() => setErrorMsg('')}>
                    ×
                  </button>
                </div>
              )}
              <form
                onSubmit={e => {
                  e.preventDefault()
                  saveEntry()
                }}
              >
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="provider-select">Provider</label>
                    <select
                      id="provider-select"
                      value={form.provider || 'hilogate'}
                      onChange={e => setForm(resetFormDefaults(e.target.value))}
                      className="clean-select"
                    >
                      <option value="hilogate">Hilogate</option>
                      <option value="oy">OY</option>
                      <option value="gidi">Gidi</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="connection-name">Name</label>
                    <input
                      id="connection-name"
                      placeholder="Nama koneksi"
                      type="text"
                      value={form.name || ''}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="clean-input"
                    />
                  </div>
                </div>

                <div className="credentials-group">{renderCredentialInputs()}</div>

                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.schedule?.weekday ?? false}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          schedule: { ...(f.schedule as any), weekday: e.target.checked },
                        }))
                      }
                    />
                    <span className="checkbox-text">Weekday</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.schedule?.weekend ?? false}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          schedule: { ...(f.schedule as any), weekend: e.target.checked },
                        }))
                      }
                    />
                    <span className="checkbox-text">Weekend</span>
                  </label>
                </div>

                <div className="actions-row">
                  <button type="button" className="btn secondary" disabled={saving} onClick={() => !saving && (setShowForm(false), setEditId(null))}>
                    Batal
                  </button>
                  <button type="submit" className="btn primary" disabled={saving}>
                    {saving ? (
                      <div className="inline-flex">
                        <Spinner />
                        <span className="ml4">{editId ? 'Updating...' : 'Menyimpan...'}</span>
                      </div>
                    ) : editId ? (
                      'Update'
                    ) : (
                      'Simpan'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Styles */}
      <style jsx>{`
        .page-container {
          max-width: 1080px;
          margin: 0 auto;
          padding: 24px 16px;
          font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
          color: #1f2937;
          background: #f5f7fa;
          min-height: 100vh;
          box-sizing: border-box;
        }
        .header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .title {
          font-size: 24px;
          font-weight: 600;
        }
        .inline-flex {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .ml8 {
          margin-left: 8px;
        }
        .ml4 {
          margin-left: 4px;
        }
        .btn {
          border: none;
          cursor: pointer;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: filter .2s ease;
          line-height: 1.1;
        }
        .btn.primary {
          background: #1d4ed8;
          color: white;
        }
        .btn.primary:hover:not(:disabled) {
          filter: brightness(1.1);
        }
        .btn.primary:focus-visible {
          outline: 3px solid #93c5fd;
          outline-offset: 2px;
        }
        .btn.primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn.secondary {
          background: #f0f4f8;
          color: #1f2937;
        }
        .btn.neutral {
          background: #f9fafb;
          color: #374151;
        }
        .btn.small {
          padding: 6px 12px;
          font-size: 12px;
        }
        .btn.danger {
          background: #fca5a5;
          color: #7f1d1d;
        }
        .card {
          background: white;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(31, 41, 55, 0.08);
          overflow: hidden;
          margin-top: 8px;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #e5e7eb;
        }
        .section-title {
          font-size: 16px;
          font-weight: 600;
        }
        .small-muted {
          font-size: 12px;
          color: #6b7280;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .table-wrapper {
          overflow-x: auto;
        }
        table.providers {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        table.providers thead {
          background: #f3f4f6;
        }
        table.providers th {
          text-align: left;
          padding: 12px 16px;
          font-size: 11px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: #4b5563;
          border-bottom: 1px solid #e5e7eb;
        }
        table.providers td {
          padding: 12px 16px;
          vertical-align: middle;
          border-bottom: 1px solid #f0f2f7;
        }
        table.providers tr:hover {
          background: #fafbfc;
        }
        .font-medium {
          font-weight: 600;
        }
        .empty {
          text-align: center;
          padding: 40px 0;
          color: #9ca3af;
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        .badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .badge-hilogate {
          background: #e5e7ff;
          color: #4338ca;
        }
        .badge-oy {
          background: #d1fae5;
          color: #065f46;
        }
        .badge-gidi {
          background: #fef3c7;
          color: #854d0e;
        }
        .schedule-indicator {
          display: flex;
          gap: 12px;
        }
        .dot-label {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #d1d5db;
        }
        .dot.active {
          background: #22c55e;
        }
        .label-text {
          font-size: 12px;
          color: #374151;
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.45);
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding: 40px 16px;
          z-index: 50;
          overflow: auto;
        }
        .modal {
          background: white;
          border-radius: 16px;
          width: 100%;
          max-width: 640px;
          box-shadow: 0 24px 48px rgba(31, 41, 55, 0.15);
          position: relative;
          display: flex;
          flex-direction: column;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #e5e7eb;
        }
        .modal-title {
          font-size: 18px;
          font-weight: 600;
        }
        .close {
          background: transparent;
          border: none;
          font-size: 24px;
          cursor: pointer;
          line-height: 1;
          padding: 0;
          color: #6b7280;
        }
        .modal-body {
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          position: relative;
        }
        .banner.error {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fca5a5;
        }
        .dismiss {
          background: transparent;
          border: none;
          font-size: 18px;
          cursor: pointer;
          margin-left: 12px;
        }
        .form-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .form-field {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 180px;
        }
        .form-field label {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        input,
        select {
          padding: 12px 14px;
          font-size: 14px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          outline: none;
          transition: border-color 0.15s;
        }
        input:focus,
        select:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
        }
        .clean-input,
        .clean-select {
          padding: 12px 14px;
          font-size: 14px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          outline: none;
          width: 100%;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
          background: #ffffff;
        }
        .clean-input::placeholder {
          color: #9ca3af;
        }
        .credentials-group {
          margin-bottom: 16px;
        }
        .checkbox-row {
          display: flex;
          gap: 24px;
          margin: 12px 0 20px;
        }
        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 14px;
        }
        .checkbox-label input {
          width: 16px;
          height: 16px;
        }
        .checkbox-text {
          margin-left: 2px;
        }
        .actions-row {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 8px;
        }
        .form-grid {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .field-pair {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }
        .spinner {
          width: 16px;
          height: 16px;
          border: 3px solid #cbd5e1;
          border-top-color: #2563eb;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        .title-block {
          flex: 1;
        }
        @media (max-width: 900px) {
          .field-pair {
            flex-direction: column;
          }
          .checkbox-row {
            flex-direction: column;
            gap: 8px;
          }
          .actions-row {
            flex-direction: column-reverse;
            align-items: stretch;
          }
          .actions-row .btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  )
}
