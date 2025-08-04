'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

interface AdminLog {
  id: string
  action: string
  target?: string
  adminId: string
  createdAt: string
}

export default function AdminLogsPage() {
  useRequireAuth()
  const [logs, setLogs] = useState<AdminLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<{ data: AdminLog[] }>('/admin/logs')
      .then(res => setLogs(res.data.data))
      .catch(() => setError('Gagal memuat log'))
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
      <h1 className="title">Admin Logs</h1>
      {error && <div className="error-banner">{error}</div>}
      <div className="tableWrapper">
        <table>
          <thead>
            <tr>
              <th>Aksi</th>
              <th>Target</th>
              <th>Admin ID</th>
              <th>Waktu</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td>{log.action}</td>
                <td>{log.target || '–'}</td>
                <td>{log.adminId}</td>
                <td>{new Date(log.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '1rem' }}>
                  Belum ada log
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
          font-size: 2rem;
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
          padding: 0.75rem 1rem;
          text-align: left;
          vertical-align: middle;
        }
      `}</style>
    </div>
  )
}

