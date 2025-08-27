'use client'

import { useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import './datepicker-dark.css'
import styles from './ApiLog.module.css'

interface ApiLog {
  id: string
  url: string
  statusCode: number
  errorMessage?: string
  responseBody?: string
  createdAt: string
  respondedAt?: string
}

export default function ApiLogPage() {
  const [logs, setLogs] = useState<ApiLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failure'>('all')
  const [startDate, endDate] = dateRange

  const fetchLogs = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = {}
      if (startDate) params.date_from = startDate.toISOString()
      if (endDate) params.date_to = endDate.toISOString()
      if (statusFilter !== 'all') params.success = statusFilter === 'success'

      const { data } = await apiClient.get<{ logs: ApiLog[] }>('/client/api-logs', { params })
      setLogs(data.logs || [])
    } catch (err) {
      console.error('Failed to fetch API logs', err)
      setError('Failed to load logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">API Logs</h1>

      <div className={styles.filters}>
        <DatePicker
          selectsRange
          startDate={startDate}
          endDate={endDate}
          onChange={update => setDateRange(update as [Date | null, Date | null])}
          placeholderText="Select date range"
          isClearable
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          calendarClassName="react-datepicker-dark !border !border-neutral-800 !rounded-xl !shadow-lg"
          showPopperArrow={false}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>
        <button
          onClick={fetchLogs}
          className="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-500"
        >
          Apply
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className={styles.tableWrapper}>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800">
              <th className="px-3 py-2">Request URL</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Error Message</th>
              <th className="px-3 py-2">Response Body</th>
              <th className="px-3 py-2">Requested At</th>
              <th className="px-3 py-2">Responded At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center">Loading...</td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center">No logs found</td>
              </tr>
            ) : (
              logs.map(log => (
                <tr key={log.id} className="border-b border-neutral-800">
                  <td className="px-3 py-2 break-all">{log.url}</td>
                  <td className="px-3 py-2">{log.statusCode}</td>
                  <td className="px-3 py-2">{log.errorMessage || '-'}</td>
                  <td className="px-3 py-2 whitespace-pre-wrap break-all">
                    <pre className="max-h-40 overflow-auto">{log.responseBody || '-'}</pre>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{log.respondedAt ? new Date(log.respondedAt).toLocaleString() : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
