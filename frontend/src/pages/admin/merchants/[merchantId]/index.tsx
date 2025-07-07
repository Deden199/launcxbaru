'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'

interface ProviderEntry {
  id: string
  provider: string
  credentials: {
    merchantId: string
    env: string
    secretKey: string
  }
  schedule: {
    weekday: boolean
    weekend: boolean
  }
}

export default function PaymentProvidersPage() {
  const router = useRouter()
  const { merchantId } = router.query as { merchantId?: string }

  const [merchant, setMerchant] = useState<{ name: string } | null>(null)
  const [entries, setEntries] = useState<ProviderEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState<Partial<ProviderEntry>>({
    provider: 'hilogate',
    credentials: { merchantId: '', env: 'sandbox', secretKey: '' },
    schedule: { weekday: true, weekend: false },
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

  async function addEntry() {
    if (!merchantId) return
    setErrorMsg('')

    const creds = form.credentials
    if (!creds?.merchantId || !creds.secretKey) {
      setErrorMsg('Semua field kredensial harus diisi.')
      return
    }

    try {
      await api.post(`/admin/merchants/${merchantId}/pg`, {
        provider: form.provider,
        credentials: creds,
        schedule: form.schedule
      })
      setShowForm(false)
      fetchEntries()
    } catch (err: any) {
      setErrorMsg(err.response?.data.error || 'Gagal menyimpan, coba lagi.')
    }
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
          onClick={() => { setErrorMsg(''); setShowForm(true) }}
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
              <th>Merchant ID</th>
              <th>Env</th>
              <th>Weekday</th>
              <th>Weekend</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td className="cell-bold">{e.provider}</td>
                <td>{e.credentials.merchantId}</td>
                <td>{e.credentials.env}</td>
                <td>{e.schedule.weekday ? '✔' : '–'}</td>
                <td>{e.schedule.weekend ? '✔' : '–'}</td>
                <td>
                  <button className="delete-btn" onClick={() => deleteEntry(e.id)}>
                    Hapus
                  </button>
                </td>
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

      {showForm && (
        <div className="overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Tambah Provider Baru</h3>
            {errorMsg && <div className="error-banner">{errorMsg}</div>}

            <div className="form-group">
              <label>Provider</label>
              <select
                value={form.provider}
                onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
              >
                <option value="hilogate">Hilogate</option>
                <option value="oy">OY</option>
              </select>
            </div>

            <div className="form-group">
              <label>Environment</label>
              <select
                value={form.credentials?.env}
                onChange={e => setForm(f => ({
                  ...f,
                  credentials: { ...f.credentials!, env: e.target.value }
                }))}
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </div>

            <div className="form-group">
              <label>Merchant ID</label>
              <input
                type="text"
                value={form.credentials?.merchantId || ''}
                onChange={e => setForm(f => ({
                  ...f,
                  credentials: { ...f.credentials!, merchantId: e.target.value }
                }))}
              />
            </div>

            <div className="form-group">
              <label>Secret Key</label>
              <input
                type="text"
                value={form.credentials?.secretKey || ''}
                onChange={e => setForm(f => ({
                  ...f,
                  credentials: { ...f.credentials!, secretKey: e.target.value }
                }))}
              />
            </div>

            <div className="checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={form.schedule?.weekday ?? false}
                  onChange={e => setForm(f => ({
                    ...f,
                    schedule: { ...f.schedule!, weekday: e.target.checked }
                  }))}
                /> Weekday
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.schedule?.weekend ?? false}
                  onChange={e => setForm(f => ({
                    ...f,
                    schedule: { ...f.schedule!, weekend: e.target.checked }
                  }))}
                /> Weekend
              </label>
            </div>

            <div className="modal-actions">
              <button className="save-btn" onClick={addEntry}>Simpan</button>
              <button className="cancel-btn" onClick={() => setShowForm(false)}>Batal</button>
            </div>
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
  background: #ffffff;             /* putih cerah */
  border-radius: 16px;             /* sudut lebih halus */
  padding: 2rem;
  width: 380px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.3); /* shadow lebih pekat */
  border: 1px solid rgba(0, 0, 0, 0.1);      /* garis tipis pembeda */
  z-index: 1001;                    /* di atas overlay */
}
/* Bungkus semua field dalam <form> agar mudah atur gap */
.modal form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
