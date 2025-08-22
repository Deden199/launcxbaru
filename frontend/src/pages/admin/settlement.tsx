'use client'

import { useState } from 'react'
import api from '@/lib/api'
import { useRequireAuth } from '@/hooks/useAuth'

interface Result {
  settledOrders: number
  netAmount: number
}

export default function ManualSettlementPage() {
  useRequireAuth()
  const [batches, setBatches] = useState('1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  const run = async () => {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await api.post<{ data: Result }>('/admin/settlement', {
        batches: Number(batches) || 1,
      })
      setResult(res.data.data)
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to run settlement')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-md">
      <h1 className="text-3xl font-bold mb-4">Manual Settlement</h1>
      {error && <div className="text-red-600 mb-3">{error}</div>}
      <div className="flex items-center space-x-2 mb-4">
        <input
          type="number"
          min={1}
          value={batches}
          onChange={e => setBatches(e.target.value)}
          className="border px-3 py-2 rounded w-24"
        />
        <button
          onClick={run}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          {loading ? 'Running…' : 'Run'}
        </button>
      </div>
      {result && (
        <div className="mt-4">
          <p>Settled Orders: {result.settledOrders}</p>
          <p>
            Net Amount:{' '}
            {result.netAmount.toLocaleString('id-ID', {
              style: 'currency',
              currency: 'IDR',
            })}
          </p>
        </div>
      )}
    </div>
  )
}

