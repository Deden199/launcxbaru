// frontend/src/pages/admin/clients/[clientId].tsx
'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

interface Client {
  id: string
  name: string
  apiKey: string
  apiSecret: string
  isActive: boolean
  feePercent: number
  feeFlat: number
  withdrawFeePercent: number    // new
  withdrawFeeFlat: number       // new
  parentClientId?: string
  childrenIds?: string[]
  defaultProvider?: string
    weekendFeePercent: number
  weekendFeeFlat: number
  forceSchedule?: string

}

type Option = { id: string; name: string }

export default function EditClientPage() {
  useRequireAuth()
  const router = useRouter()
  const { clientId } = router.query as { clientId?: string }

  const [client, setClient]               = useState<Client | null>(null)
  const [options, setOptions]             = useState<Option[]>([])
  const [name, setName]                   = useState('')
  const [isActive, setIsActive]           = useState(true)
  const [feePercent, setFeePercent]       = useState<number>(0)
  const [feeFlat, setFeeFlat]             = useState<number>(0)
    const [weekendFeePercent, setWeekendFeePercent] = useState<number>(0)
  const [weekendFeeFlat, setWeekendFeeFlat] = useState<number>(0)
  const [withdrawFeePercent, setWithdrawFeePercent] = useState<number>(0) // new
  const [withdrawFeeFlat, setWithdrawFeeFlat]       = useState<number>(0) // new
  const [parentClientId, setParentClientId] = useState<string>('')
  const [childrenIds, setChildrenIds]     = useState<string[]>([])
  const [defaultProvider, setDefaultProvider] = useState<string>('')
  const [forceSchedule, setForceSchedule] = useState<string>('')
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')

  // Load client data
  useEffect(() => {
    if (!clientId) return
    api.get<Client>(`/admin/clients/${clientId}`)
      .then(res => {
        const c = res.data
        setClient(c)
        setName(c.name)
        setIsActive(c.isActive)
        setFeePercent(c.feePercent)
        setFeeFlat(c.feeFlat)
                setWeekendFeePercent(c.weekendFeePercent)
        setWeekendFeeFlat(c.weekendFeeFlat)
        setWithdrawFeePercent(c.withdrawFeePercent)  // new
        setWithdrawFeeFlat(c.withdrawFeeFlat)        // new
        setParentClientId(c.parentClientId || '')
        setChildrenIds(c.childrenIds || [])
        setDefaultProvider(c.defaultProvider || '')
        setForceSchedule(c.forceSchedule || '')

      })
      .catch(() => setError('Gagal memuat data client'))
  }, [clientId])

  // Load all clients as options
  useEffect(() => {
    if (!clientId) return
    api.get<Option[]>('/admin/clients')
      .then(res => setOptions(res.data.filter(o => o.id !== clientId)))
      .catch(() => {})
  }, [clientId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name tidak boleh kosong')
      return
    }
    if (!defaultProvider) {
      setError('Default provider harus dipilih')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.put(`/admin/clients/${clientId}`, {
        name: name.trim(),
        isActive,
        feePercent,
        feeFlat,
        weekendFeePercent,
        weekendFeeFlat,
        withdrawFeePercent,  // new
        withdrawFeeFlat,     // new
        parentClientId: parentClientId || null,
        childrenIds,
        defaultProvider,
        forceSchedule: forceSchedule || null
            })
      router.push('/admin/clients')
    } catch (e: any) {
      setError(e.response?.data?.error || 'Gagal menyimpan perubahan')
    } finally {
      setLoading(false)
    }
  }

  if (!clientId || !client) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Edit Client</h1>
                <div className="user-action">
          <button type="button" onClick={() => router.push(`/admin/clients/${clientId}/users`)}>
            Manage Users
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit} className="form-grid">

          <div className="field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Client Name"
            />
          </div>

          <div className="field">
            <label>Default Provider</label>
            <div className="default-select-wrapper">
              <select
                value={defaultProvider}
                onChange={e => setDefaultProvider(e.target.value)}
              >
                <option value="">-- Select Provider --</option>
                <option value="hilogate">Hilogate</option>
                <option value="oy">OY Indonesia</option>
               <option value="gidi">Gidi</option>

              </select>
            </div>
          </div>
          <div className="field">
            <label>Force Schedule</label>
            <div className="default-select-wrapper">
              <select
                value={forceSchedule}
                onChange={e => setForceSchedule(e.target.value)}
              >
                <option value="">Auto</option>
                <option value="weekday">Weekday</option>
                <option value="weekend">Weekend</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>Active</label>
            <div className="toggle-switch">
              <input
                id="activeToggle"
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
              />
              <label htmlFor="activeToggle"></label>
            </div>
          </div>

          <div className="field">
            <label>Transaction Fee %</label>
            <input
              type="number"
              step={0.001}
              min={0}
              max={100}
              value={feePercent}
              onChange={e => setFeePercent(parseFloat(e.target.value) || 0)}
              placeholder="0.000"
            />
          </div>

          <div className="field">
            <label>Transaction Fee Flat</label>
            <input
              type="number"
              step={0.01}
              min={0}
              value={feeFlat}
              onChange={e => setFeeFlat(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>
      <div className="field">
            <label>Weekend Fee %</label>
            <input
              type="number"
              step={0.001}
              min={0}
              max={100}
              value={weekendFeePercent}
              onChange={e => setWeekendFeePercent(parseFloat(e.target.value) || 0)}
              placeholder="0.000"
            />
          </div>

          <div className="field">
            <label>Weekend Fee Flat</label>
            <input
              type="number"
              step={0.01}
              min={0}
              value={weekendFeeFlat}
              onChange={e => setWeekendFeeFlat(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>

          {/* New withdraw fee fields */}
          <div className="field">
            <label>Withdraw Fee %</label>
            <input
              type="number"
              step={0.001}
              min={0}
              max={100}
              value={withdrawFeePercent}
              onChange={e => setWithdrawFeePercent(parseFloat(e.target.value) || 0)}
              placeholder="0.000"
            />
          </div>

          <div className="field">
            <label>Withdraw Fee Flat</label>
            <input
              type="number"
              step={0.01}
              min={0}
              value={withdrawFeeFlat}
              onChange={e => setWithdrawFeeFlat(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>

          <div className="field full-width">
            <label>Parent Client</label>
            <div className="select-wrapper">
              <select
                value={parentClientId}
                onChange={e => setParentClientId(e.target.value)}
              >
                <option value="">None</option>
                {options.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field full-width">
            <label>Children</label>
            <div className="chips-container">
              {options.map(o => {
                const selected = childrenIds.includes(o.id)
                return (
                  <button
                    type="button"
                    key={o.id}
                    className={selected ? 'chip selected' : 'chip'}
                    onClick={() => {
                      if (selected) setChildrenIds(ids => ids.filter(i => i !== o.id))
                      else setChildrenIds(ids => [...ids, o.id])
                    }}
                  >
                    {o.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="full-width action">
            <button type="submit" disabled={loading}>
              {loading ? 'Menyimpan...' : 'Save Changes'}
            </button>
          </div>

        </form>
      </div>


      <style jsx>{`
        .container {
          max-width: 800px;
          margin: 2rem auto;
          padding: 0 1rem;
        }
        .card {
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.1);
          padding: 2rem;
        }
        h1 {
          font-size: 1.75rem;
          margin-bottom: 1rem;
          font-weight: 600;
        }
                  .user-action {
          text-align: right;
          margin-bottom: 1rem;
        }
        .user-action button {
          background: #0070f3;
          color: #fff;
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }
        .user-action button:hover {
          background: #005bb5;
        }
        .error-banner {
          background: #ffe0e0;
          color: #900;
          padding: 0.75rem;
          border-radius: 6px;
          margin-bottom: 1rem;
        }
        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 1.5rem;
        }
        .field {
          display: flex;
          flex-direction: column;
        }
        .field.full-width {
          grid-column: 1 / -1;
        }
        label {
          font-weight: 500;
          margin-bottom: 0.5rem;
        }
        input[type="text"],
        input[type="number"],
        .select-wrapper select {
          padding: 0.6rem 0.75rem;
          border: 1px solid #ccc;
          border-radius: 6px;
          font-size: 1rem;
          transition: border-color 0.2s;
        }
        input:focus, .select-wrapper select:focus {
          outline: none;
          border-color: #0070f3;
        }
        .toggle-switch {
          position: relative;
          width: 50px;
          height: 24px;
        }
        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-switch label {
          position: absolute;
          cursor: pointer;
          background: #ccc;
          border-radius: 12px;
          width: 100%;
          height: 100%;
          transition: background 0.2s;
        }
        .toggle-switch label:after {
          content: '';
          position: absolute;
          left: 4px;
          top: 4px;
          width: 16px;
          height: 16px;
          background: #fff;
          border-radius: 50%;
          transition: transform 0.2s;
        }
        .toggle-switch input:checked + label {
          background: #0070f3;
        }
        .toggle-switch input:checked + label:after {
          transform: translateX(26px);
        }
        .chips-container {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .chip {
          padding: 0.4rem 0.75rem;
          border: 1px solid #ccc;
          border-radius: 16px;
          background: #f5f5f5;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }
        .chip.selected {
          background: #0070f3;
          color: #fff;
          border-color: #0070f3;
        }
        .action {
          text-align: right;
        }
        .action button {
          background: #0070f3;
          color: #fff;
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          cursor: pointer;
          transition: background 0.2s;
        }
        .action button:disabled {
          background: #999;
          cursor: not-allowed;
        }
        .action button:not(:disabled):hover {
          background: #005bb5;
        }
          /* container untuk custom arrow */
.default-select-wrapper {
  position: relative;
  width: 100%;
}

/* styling dropdown */
.default-select-wrapper select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  width: 100%;
  padding: 0.6rem 1rem;
  font-size: 1rem;
  border: 1px solid #cbd5e1;
  border-radius: var(--radius);
  background-color: #fff;
  color: var(--clr-text);
  cursor: pointer;
  transition: border-color 0.2s;
}

/* border-color saat focus */
.default-select-wrapper select:focus {
  outline: none;
  border-color: var(--clr-primary);
}

/* panah custom */
.default-select-wrapper::after {
  content: '▾';
  position: absolute;
  top: 50%;
  right: 1rem;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--clr-muted);
  font-size: 0.8rem;
}

      `}</style>
    </div>
  )
}
