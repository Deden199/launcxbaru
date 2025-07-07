'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

type Merchant = {
  id: string
  name: string
  phoneNumber: string
}

export default function MerchantsListPage() {
  useRequireAuth()
  const router = useRouter()
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<Merchant[]>('/admin/merchants')
      .then(r => setMerchants(r.data))
      .catch(() => setMerchants([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="container">
        <p className="loading">Loading…</p>
        <style jsx>{`
          .loading {
            text-align: center;
            color: #6b7280;
            font-size: 1.125rem;
            padding: 2rem 0;
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="container">
      <h1 className="title">Daftar Merchant</h1>
      <div className="tableWrapper">
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th>Telepon</th>
              <th>Aksi</th> {/* <-- Tambahkan judul kolom */}
            </tr>
          </thead>
          <tbody>
            {merchants.map(m => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.phoneNumber || '–'}</td>
                <td>
                  <button onClick={() => router.push(`/admin/merchants/${m.id}`)}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
            {merchants.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: '1rem' }}>
                  Belum ada data merchant
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .container {
          max-width: 900px;
          margin: 3rem auto;
          padding: 2rem;
          background: #fff;
          border-radius: 1rem;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        }
        .title {
          font-size: 2.25rem;
          font-weight: 700;
          margin-bottom: 1.5rem;
          color: #111827;
          text-align: center;
        }
        .tableWrapper {
          overflow-x: auto;
          border-radius: 0.75rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
        }
        thead {
          background: #f3f4f6;
        }
        th,
        td {
          padding: 1rem 1.25rem;
          text-align: left;
          vertical-align: middle;
        }
        thead th {
          font-size: 0.95rem;
          font-weight: 600;
          color: #374151;
        }
        tbody tr {
          background: #fff;
          transition: background 0.2s;
        }
        tbody tr:nth-child(even) {
          background: #fafafa;
        }
        tbody tr:hover {
          background: #f0fdf4;
        }
        button {
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: #fff;
          background: #10b981;
          border: none;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
        }
        button:hover {
          background: #059669;
          transform: translateY(-1px);
        }
        button:active {
          transform: translateY(0);
        }
      `}</style>
    </div>
  )
}
