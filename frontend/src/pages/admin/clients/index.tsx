'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'
import { ClipboardCopy, Search, X } from 'lucide-react'


interface Client {
  id: string
  name: string
  apiKey: string
  apiSecret: string
  isActive: boolean
  feePercent: number
  feeFlat: number
  defaultProvider: string           // ← tambahkan ini
  forceSchedule?: string
  parentClient?: { id: string; name: string }
  children?: { id: string; name: string }[]
}

type CreateResp = {
  client: Client
  defaultUser: { email: string; password: string }
}

export default function ApiClientsPage() {
  useRequireAuth()
  
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newFeePercent, setNewFeePercent] = useState<number>(0.5)
  const [newFeeFlat, setNewFeeFlat] = useState<number>(0)
  const [newParentId, setNewParentId] = useState<string>('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [creds, setCreds] = useState<CreateResp | null>(null)
const [newDefaultProvider, setNewDefaultProvider] = useState<string>('hilogate')
const [newForceSchedule, setNewForceSchedule] = useState<string>('')

  useEffect(() => { loadClients() }, [])

  async function loadClients() {
    try {
      const res = await api.get<Client[]>('/admin/clients')
      setClients(res.data)
    } catch {
      setErr('Gagal memuat daftar client')
    }
  }

  async function addClient() {
    if (!newName.trim() || !newEmail.trim()) {
      setErr('Nama dan email tidak boleh kosong')
      return
    }
    setErr('')
    setLoading(true)
    try {
      const payload: any = {
        name: newName.trim(),
        email: newEmail.trim(),
        feePercent: newFeePercent,
        feeFlat: newFeeFlat,
        defaultProvider: newDefaultProvider,  // ← tambahkan ini
        forceSchedule: newForceSchedule || null,


      }
      if (newParentId) payload.parentClientId = newParentId
      const res = await api.post<CreateResp>('/admin/clients', payload)
      setClients(cs => [res.data.client, ...cs])
      setCreds(res.data)
      setNewName(''); setNewEmail(''); setNewFeePercent(0.5); setNewFeeFlat(0); setNewParentId(''); setNewForceSchedule('')
    } catch (e: any) {
      setErr(e.response?.data?.error || 'Gagal menambah client')
    } finally {
      setLoading(false)
    }
  }

  function copy(txt: string) {
    navigator.clipboard.writeText(txt)
      .then(() => alert('Disalin!'))
      .catch(() => alert('Gagal menyalin'))
  }

const [debouncedSearch, setDebouncedSearch] = useState(search)

// debounce sync: update debouncedSearch setelah user berhenti ketik 250ms
useEffect(() => {
  const t = setTimeout(() => setDebouncedSearch(search), 250)
  return () => clearTimeout(t)
}, [search])

// filtered menggunakan debouncedSearch
const filteredClients = clients.filter(c =>
  c.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
  c.id.includes(debouncedSearch)
)


  return (
    <div className="container">
      <h1 className="page-title">API Clients</h1>

      <div className="card form-card">
        <h2>Create New Client</h2>
        <div className="form-grid">
          <input
            placeholder="Client Name" value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <input
            placeholder="Client Email" type="email" value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
          />
          <select
  value={newDefaultProvider}
  onChange={e => setNewDefaultProvider(e.target.value)}
>
  <option value="hilogate">Hilogate</option>
  <option value="oy">OY Indonesia</option>
 <option value="gidi">Gidi</option>

  </select>
          <select
  value={newForceSchedule}
  onChange={e => setNewForceSchedule(e.target.value)}
>
  <option value="">Auto</option>
  <option value="weekday">Weekday</option>
  <option value="weekend">Weekend</option>
</select>
          {/* <select value={newParentId} onChange={e => setNewParentId(e.target.value)}>
            <option value="">No Parent</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select> */}
          {/* <input
            placeholder="Fee %" type="number" step={0.001} min={0} max={100}
            value={newFeePercent}
            onChange={e => setNewFeePercent(parseFloat(e.target.value) || 0)}
          />
          <input
            placeholder="Fee Flat" type="number" step="0.01" min={0}
            value={newFeeFlat}
            onChange={e => setNewFeeFlat(parseFloat(e.target.value) || 0)}
          /> */}
          <button onClick={addClient} disabled={loading}>
            {loading ? 'Menambahkan…' : 'Tambah Client'}
          </button>
        </div>
        {err && <div className="error-banner">{err}</div>}
      </div>

      {creds && (
        <div className="popup">
          <div className="popup-content">
            <h3>Client Credentials</h3>
            <p><strong>Email:</strong> <code>{creds.defaultUser.email}</code></p>
            <p><strong>Password:</strong> <code>{creds.defaultUser.password}</code></p>
            <button onClick={() => setCreds(null)}>Close</button>
          </div>
        </div>
      )}
<div className="search-wrapper">
  <div className="search-box">
    <div className="icon-left">
      <Search size={16} aria-hidden="true" />
    </div>
    <input
      id="client-search"
      placeholder="Cari client atau ID…"
      value={search}
      onChange={e => setSearch(e.target.value)}
      aria-label="Search clients"
      autoComplete="off"
    />
    {search && (
      <button
        type="button"
        className="clear-btn"
        aria-label="Clear search"
        onClick={() => {
          setSearch('')
          // reset debounce immediate
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    )}
  </div>
</div>


      <div className="cards-grid">
        {filteredClients.length === 0 ? (
          <p className="empty">
            {clients.length === 0 ? 'Belum ada client' : 'No clients found'}
          </p>
        ) : (
          filteredClients.map(c => (
            <div className="client-card" key={c.id}>
              <div className="card-header">
                <h4>{c.name}</h4>
                <span className={c.isActive ? 'status active' : 'status inactive'}>
                  {c.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="card-body">
                <p><strong>Key:</strong>
                  <span className="mono">{c.apiKey}</span>
                  <ClipboardCopy onClick={() => copy(c.apiKey)} />
                </p>
                {/* <p><strong>Secret:</strong>
                  <span className="mono">{c.apiSecret}</span>
                  <ClipboardCopy onClick={() => copy(c.apiSecret)} />
                </p> */}
                <p><strong>Default PG:</strong> {c.defaultProvider}</p>
                                {c.forceSchedule && (
                  <p><strong>Force Schedule:</strong> {c.forceSchedule}</p>
                )}
                <p><strong>Parent:</strong> {c.parentClient?.name || '-'}</p>
                <p><strong>Children:</strong> {c.children?.length || 0}</p>
                <p><strong>Fee %:</strong> {c.feePercent.toFixed(3)}</p>
                <p><strong>Fee Flat:</strong> {c.feeFlat.toFixed(2)}</p>
              </div>
              <div className="card-footer">
                <button onClick={() => router.push(`/admin/clients/${c.id}`)}>
                  Manage
                </button>
                 <button onClick={() => router.push(`/admin/clients/${c.id}/dashboard`)}>
                  Dashboard
                </button>
                 <button onClick={() => router.push(`/admin/clients/${c.id}/withdraw`)}>
                  Withdrawals
                </button>
              </div>
            </div>
          )))}
        </div>

      <style jsx>{`
 /* ApiClients.module.css */

.container {
  /* palette di-scope di sini */
  --clr-bg: #f5f7fa;
  --clr-card: #ffffff;
  --clr-primary: #4f46e5;
  --clr-primary-dark: #4338ca;
  --clr-secondary: #14b8a6;
  --clr-text: #334155;
  --clr-muted: #64748b;
  --clr-error: #f87171;
  --radius: 12px;

  max-width: 1024px;
  margin: 2.5rem auto;
  padding: 0 1rem;
  background: var(--clr-bg);
}
.container .card-footer button + button {
  margin-left: 0.5rem;
    margin-top: 0.5rem;

}
.container .page-title {
  font-size: 2.25rem;
  font-weight: 800;
  text-align: center;
  margin-bottom: 2rem;
  background: linear-gradient(90deg, var(--clr-primary), var(--clr-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
  .search-wrapper {
  margin: 1.5rem 0;
  max-width: 480px;
  width: 100%;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f0f4fa;
  border: 1px solid rgba(79, 70, 229, 0.15);
  border-radius: 12px;
  padding: 6px 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.06);
  transition: border-color .15s, box-shadow .15s;
}
.search-box:focus-within {
  border-color: var(--clr-primary);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.25);
}
.search-box input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 6px 4px;
  font-size: 0.95rem;
  color: var(--clr-text);
  outline: none;
  min-width: 0; /* important for flex shrink */
}
.icon-left {
  display: flex;
  align-items: center;
  color: rgba(100, 116, 139, 0.7);
}
.clear-btn {
  background: transparent;
  border: none;
  padding: 4px;
  display: flex;
  align-items: center;
  cursor: pointer;
  border-radius: 50%;
  transition: background .15s;
  color: rgba(100, 116, 139, 0.9);
}
.clear-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}


.container .form-card {
  background: var(--clr-card);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  padding: 2rem;
  margin-bottom: 2.5rem;
}

.container .form-card h2 {
  margin-bottom: 1rem;
  color: var(--clr-text);
}

.container .form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.25rem;
}

.container .form-grid input,
.container .form-grid select {
  padding: 0.75rem 1rem;
  font-size: 1rem;
  border: 1px solid #cbd5e1;
  border-radius: var(--radius);
  color: var(--clr-text);
  transition: border-color 0.2s;
}

.container .form-grid input:focus,
.container .form-grid select:focus {
  outline: none;
  border-color: var(--clr-primary);
}

.container .form-grid button {
  grid-column: span 1;
  background: var(--clr-primary);
  color: #fff;
  padding: 0.8rem 1.2rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
}

.container .form-grid button:not(:disabled):hover {
  background: var(--clr-primary-dark);
  transform: translateY(-2px);
}

.container .form-grid button:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.container .error-banner {
  margin-top: 1.5rem;
  background: rgba(248,81,113,0.1);
  color: var(--clr-error);
  padding: 0.8rem 1rem;
  border-radius: var(--radius);
}

.container .popup {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
}

.container .popup-content {
  background: var(--clr-card);
  border-radius: var(--radius);
  padding: 2rem;
  width: 320px;
  text-align: center;
  box-shadow: 0 12px 32px rgba(0,0,0,0.12);
}
.search-wrapper {
  margin: 1.5rem 0;
  max-width: 480px;
  width: 100%;
}
.search-inner {
  position: relative;
  display: flex;
  align-items: center; /* kunci: vertical center */
}
.search-inner input {
  flex: 1;
  padding: 0.65rem 2.5rem 0.65rem 2.5rem; /* ruang cukup untuk icon */
  font-size: 0.95rem;
  border: 1px solid rgba(203, 213, 225, 1);
  border-radius: 999px;
  background: #fff;
  color: var(--clr-text);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
  transition: border-color .15s, box-shadow .15s;
  line-height: 1.2;
  height: 40px;
  box-sizing: border-box;
}
.search-inner input:focus {
  outline: none;
  border-color: var(--clr-primary);
  box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.2);
}
.search-inner .icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: rgba(100, 116, 139, 0.7);
  display: flex;
  align-items: center;
}
.clear-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  transition: background .15s;
  color: rgba(100, 116, 139, 0.9);
}
.clear-btn:hover {
  background: rgba(0,0,0,0.04);
}

.container .cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.container .empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--clr-muted);
}

.container .client-card {
  background: var(--clr-card);
  border-radius: var(--radius);
  box-shadow: 0 6px 20px rgba(0,0,0,0.05);
  display: flex;
  flex-direction: column;
  transition: transform 0.2s, box-shadow 0.2s;
}

.container .client-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 28px rgba(0,0,0,0.1);
}

.container .card-header {
  background: linear-gradient(90deg, var(--clr-secondary), var(--clr-primary));
  padding: 1rem;
  border-top-left-radius: var(--radius);
  border-top-right-radius: var(--radius);
  display: flex; justify-content: space-between; align-items: center;
  color: #fff;
}

.container .status {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.6rem;
  border-radius: 8px;
  text-transform: uppercase;
}

.container .status.active {
  background: rgba(255,255,255,0.3);
}

.container .status.inactive {
  background: rgba(0,0,0,0.2);
}

.container .card-body {
  padding: 1rem;
  color: var(--clr-text);
}

.container .card-body p {
  margin: 0.5rem 0;
}

.container .mono {
  font-family: Menlo, monospace;
  background: #f1f5f9;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  margin-left: 0.5rem;
}

.container .card-body svg {
  margin-left: 0.4rem;
  cursor: pointer;
  vertical-align: middle;
  transition: transform 0.2s;
}

.container .card-body svg:hover {
  transform: scale(1.1);
}

.container .card-body-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.8rem;
  margin-top: 1rem;
}

.container .card-item {
  background: #f8fafc;
  padding: 0.6rem;
  border-radius: 8px;
  font-size: 0.9rem;
}

.container .card-footer {
  padding: 1rem;
  text-align: right;
}

.container .card-footer button {
  background: var(--clr-secondary);
  color: #fff;
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
}

.container .card-footer button:hover {
  background: #0d9488;
  transform: translateY(-2px);
}
/* rapikan baris label-value-icon */
.container .card-body p {
  display: grid;
  grid-template-columns: max-content 1fr max-content;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

/* pastikan <strong> (label) di kolom 1 */
.container .card-body p strong {
  grid-column: 1;
}

/* monospace value di kolom 2, wrap kalau panjang */
.container .card-body p .mono {
  grid-column: 2;
  word-break: break-all;
  background: #f1f5f9;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
}

/* icon copy di kolom 3 */
.container .card-body p svg {
  grid-column: 3;
  cursor: pointer;
  transition: transform 0.2s;
}
.container .card-body p svg:hover {
  transform: scale(1.1);
}

/* untuk baris tanpa icon (Parent, Children, Fee), kosongkan area icon */
.container .card-body p:not(:has(svg)) {
  grid-template-columns: max-content 1fr;
}

/* rapikan grup detail (jika masih pakai .card-body-grid) */
.container .card-body-grid {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.8rem;
}
.container .card-body-grid .card-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  padding: 0.6rem;
  border-radius: 8px;
  font-size: 0.9rem;
}

      `}</style>
    </div>
  )
}
