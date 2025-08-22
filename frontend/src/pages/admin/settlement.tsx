'use client'

import { useState, useEffect } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

interface Status {
  settledOrders: number
  netAmount: number
  status: JobStatus
}

export default function ManualSettlementPage() {
  useRequireAuth()
  const [starting, setStarting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')

  const start = async () => {
    setError('')
    setStatus(null)
    setJobId(null)
    setStarting(true)
    try {
      const res = await api.post<{ data: { jobId: string } }>(
        '/admin/settlement/start',
        {}
      )
      setJobId(res.data.data.jobId)
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to start settlement')
      setStarting(false)
    }
  }

  useEffect(() => {
    if (!jobId) return
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{ data: Status }>(
          `/admin/settlement/status/${jobId}`
        )
        const data = res.data.data
        setStatus(data)
        if (['completed', 'failed'].includes(data.status)) {
          clearInterval(interval)
          setStarting(false)
        }
      } catch (e: any) {
        setError(e.response?.data?.error || 'Failed to fetch status')
        clearInterval(interval)
        setStarting(false)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [jobId])

  const inProgress =
    starting || (status && ['queued', 'running'].includes(status.status))

  const progressPercent =
    status?.status === 'queued'
      ? 25
      : status?.status === 'running'
        ? 75
        : status?.status === 'completed' || status?.status === 'failed'
          ? 100
          : 0

  return (
    <div className="p-4 md:p-8 max-w-xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-6">
        Manual Settlement
      </h1>
      {error && <div className="text-red-600 mb-4">{error}</div>}
      <button
        onClick={start}
        disabled={!!inProgress}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {inProgress ? 'Processing…' : 'Start Settlement'}
      </button>
      {status && (
        <div className="mt-6 space-y-4">
          <div className="w-full bg-gray-200 rounded h-4 overflow-hidden">
            <div
              className={`h-4 ${
                status.status === 'failed' ? 'bg-red-500' : 'bg-blue-600'
              } transition-all`}
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
          {['queued', 'running'].includes(status.status) && (
            <div className="flex items-center space-x-2 text-gray-700">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
              <span>
                {status.status === 'queued'
                  ? 'Waiting to run…'
                  : 'Processing…'}
              </span>
            </div>
          )}
          {status.status === 'completed' && (
            <div className="space-y-1">
              <p>Settled Orders: {status.settledOrders}</p>
              <p>
                Net Amount:{' '}
                {status.netAmount.toLocaleString('id-ID', {
                  style: 'currency',
                  currency: 'IDR',
                })}
              </p>
            </div>
          )}
          {status.status === 'failed' && (
            <div className="text-red-600">Settlement failed.</div>
          )}
        </div>
      )}
    </div>
  )
}

