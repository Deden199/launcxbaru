import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'

type HilogateOyCredentials = {
  merchantId: string
  env: string
  secretKey: string
}

type GidiCredentials = {
  baseUrl: string
  credentialKey: string
  merchantId?: string
  subMerchantId?: string
}

type ProviderEntry = {
    id: string
  name: string
  provider: 'hilogate' | 'oy' | 'gidi'
  credentials: HilogateOyCredentials | GidiCredentials
  schedule: {
    weekday: boolean
    weekend: boolean
  }
}

export default function PaymentProvidersPage() {
  const router = useRouter()
  const { merchantId } = router.query as { merchantId?: string }
  const [editId, setEditId] = useState<string | null>(null)
  const [merchant, setMerchant] = useState<{ name: string } | null>(null)
  const [entries, setEntries] = useState<ProviderEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState<Partial<ProviderEntry>>({
    provider: 'hilogate',
    credentials: { merchantId: '', env: 'sandbox', secretKey: '' },
    schedule: { weekday: true, weekend: false },
    name: ''
  })

  useEffect(() => {
    if (merchantId) {
      api.get<{ name: string }>(`/admin/merchants/${merchantId}`)
        .then(res => setMerchant(res.data))
        .catch(() => console.error('Gagal mengambil data merchant'))
      fetchEntries()
    }
  }, [merchantId])

  async function fetchEntries() {
    try {
      const res = await api.get<ProviderEntry[]>(`/admin/merchants/${merchantId}/pg`)
      setEntries(res.data)
    } catch (err) {
      console.error('Fetch providers error', err)
    }
  }

  async function saveEntry() {
    if (!merchantId) return
    setErrorMsg('')

    const provider = form.provider
    let payloadCreds: any = {}

    if (provider === 'gidi') {
      const creds = form.credentials as GidiCredentials
      if (!creds?.baseUrl || !creds.credentialKey) {
        setErrorMsg('Semua field kredensial harus diisi.')
        return
      }
      payloadCreds = {
        baseUrl: creds.baseUrl,
        credentialKey: creds.credentialKey,
      }
      if (creds.merchantId) payloadCreds.merchantId = creds.merchantId
      if (creds.subMerchantId) payloadCreds.subMerchantId = creds.subMerchantId
    } else {
      const creds = form.credentials as HilogateOyCredentials
      if (!creds?.merchantId || !creds.secretKey) {
        setErrorMsg('Semua field kredensial harus diisi.')
        return
      }
      payloadCreds = {
        merchantId: creds.merchantId,
        env: creds.env,
        secretKey: creds.secretKey,
      }
    }

    try {
            const payload = {
        provider,
        name: form.name,
        credentials: payloadCreds,
        schedule: form.schedule,
      }

      if (editId) {
        await api.patch(`/admin/merchants/${merchantId}/pg/${editId}`, payload)

      } else {
        await api.post(`/admin/merchants/${merchantId}/pg`, payload)

      }
      setShowForm(false)
      setEditId(null)
      fetchEntries()
    } catch (err: any) {
      setErrorMsg(err.response?.data.error || 'Gagal menyimpan, coba lagi.')
    }
  }

  function startEdit(entry: ProviderEntry) {
    setForm(entry)
    setEditId(entry.id)
    setErrorMsg('')
    setShowForm(true)
  }

  async function deleteEntry(subId: string) {
    if (!merchantId) return
    if (!confirm('Yakin ingin menghapus koneksi ini?')) return

    try {
      await api.delete(`/admin/merchants/${merchantId}/pg/${subId}`)
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
            setForm({ provider: 'hilogate', credentials: { merchantId: '', env: 'sandbox', secretKey: '' }, schedule: { weekday: true, weekend: false }, name: '' })
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
              <th>Merchant ID / Base URL</th>
              <th>Env</th>
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
                <td>{'merchantId' in e.credentials ? e.credentials.merchantId : ('baseUrl' in e.credentials ? e.credentials.baseUrl : '')}</td>
                <td>{'env' in e.credentials ? e.credentials.env : ''}</td>
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
                    const provider = e.target.value as ProviderEntry['provider']
                    const creds =
                      provider === 'gidi'
                        ? { baseUrl: '', credentialKey: '', merchantId: '', subMerchantId: '' }
                        : { merchantId: '', env: 'sandbox', secretKey: '' }
                    setForm(f => ({ ...f, provider, credentials: creds }))
                  }}
                >
                  <option value="hilogate">Hilogate</option>
                  <option value="oy">OY</option>
                   <option value="gidi">Gidi</option>

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
                            env: e.target.value,
                          },
                        }))
                      }
                    >
                      <option value="sandbox">Sandbox</option>
                      <option value="production">Production</option>
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
