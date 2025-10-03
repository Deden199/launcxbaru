import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { JSDOM } from 'jsdom'
import Module from 'node:module'
import path from 'node:path'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'


dayjs.extend(utc)
dayjs.extend(timezone)

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
const { window } = dom

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  Event: window.Event,
  Node: window.Node,
  getComputedStyle: window.getComputedStyle.bind(window),
})

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number
}
if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle)
}

// React Testing Library expects this flag when using React 19
// @ts-ignore intentional global assignment
globalThis.IS_REACT_ACT_ENVIRONMENT = true

type ApiCall = [string, ...any[]]
type ApiImplementation = (...args: any[]) => Promise<any>

function createApiMock() {
  const apiMock = {
    getCalls: [] as ApiCall[],
    postCalls: [] as ApiCall[],
    _getImpl: (async () => {
      throw new Error('api.get implementation not set')
    }) as ApiImplementation,
    _postImpl: (async () => {
      throw new Error('api.post implementation not set')
    }) as ApiImplementation,
    setGetImplementation(fn: ApiImplementation) {
      apiMock._getImpl = fn
    },
    setPostImplementation(fn: ApiImplementation) {
      apiMock._postImpl = fn
    },
    async get(...args: any[]) {
      apiMock.getCalls.push(args as ApiCall)
      return apiMock._getImpl(...args)
    },
    async post(...args: any[]) {
      apiMock.postCalls.push(args as ApiCall)
      return apiMock._postImpl(...args)
    },
    reset() {
      apiMock.getCalls = []
      apiMock.postCalls = []
      apiMock._getImpl = (async () => {
        throw new Error('api.get implementation not set')
      }) as ApiImplementation
      apiMock._postImpl = (async () => {
        throw new Error('api.post implementation not set')
      }) as ApiImplementation
    },
  }

  return apiMock
}

const apiMock = createApiMock()

const moduleAliasRoot = path.resolve(__dirname, '..')
const moduleConstructor = Module as any
if (!moduleConstructor.__cleanupAliasPatched) {
  const originalResolve = moduleConstructor._resolveFilename.bind(moduleConstructor)
  moduleConstructor._resolveFilename = function (request: string, parent, isMain, options) {
    if (request.startsWith('@/')) {
      const mapped = path.resolve(moduleAliasRoot, request.slice(2))
      return originalResolve(mapped, parent, isMain, options)
    }
    if (request.endsWith('.css')) {
      const mapped = path.resolve(__dirname, 'styleMock.ts')
      return originalResolve(mapped, parent, isMain, options)
    }
    return originalResolve(request, parent, isMain, options)
  }
  moduleConstructor.__cleanupAliasPatched = true
}

const settlementAdjustModule = require('../pages/admin/settlement-adjust') as typeof import('../pages/admin/settlement-adjust')
const {
  SettlementAdjustJobControl,
  ReversalCleanupPanel,
  toWibExclusiveEnd,
  toWibStart,
} = settlementAdjustModule
type SettlementAdjustJobControlProps = import('../pages/admin/settlement-adjust').SettlementAdjustJobControlProps

const ADJUST_JOB_PATH = '/admin/settlement/adjust/job'
const ADJUST_STATUS_PREFIX = '/admin/settlement/adjust/status/'
const CLEANUP_PREVIEW_PATH = '/admin/settlement/cleanup-reversal/preview'
const CLEANUP_EXECUTE_PATH = '/admin/settlement/cleanup-reversal'

const defaultProps: Pick<SettlementAdjustJobControlProps, 'apiClient'> = {
  apiClient: apiMock as unknown as SettlementAdjustJobControlProps['apiClient'],
}

beforeEach(() => {
  apiMock.reset()
})

afterEach(() => {
  cleanup()
})

test('starts settlement adjust job and displays completion summary', async () => {
  const start = new Date('2024-01-02T10:00:00Z')
  const end = new Date('2024-01-03T09:59:59Z')
  let finishedCount = 0
  let capturedPayload: any = null

  apiMock.setPostImplementation(async (url: string, payload: any) => {
    if (url === ADJUST_JOB_PATH) {
      capturedPayload = payload
      return { data: { jobId: 'job-123' } }
    }
    throw new Error(`Unhandled POST ${url}`)
  })

  apiMock.setGetImplementation(async (url: string) => {
    if (url === `${ADJUST_STATUS_PREFIX}job-123`) {
      return {
        data: {
          status: 'completed',
          processed: 2,
          total: 2,
          updatedCount: 2,
          updatedIds: ['order-1', 'order-2'],
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  const { getByRole, findByText } = render(
    <SettlementAdjustJobControl
      {...defaultProps}
      selectedSubMerchant="sub-merchant-1"
      dateRange={[start, end]}
      onJobFinished={() => {
        finishedCount += 1
      }}
    />
  )

  const button = getByRole('button', { name: 'Mulai Penandaan Settlement' })
  fireEvent.click(button)

  await waitFor(() => {
    assert.equal(finishedCount, 1)
  })

  assert.ok(capturedPayload)
  assert.equal(capturedPayload.subMerchantId, 'sub-merchant-1')
  assert.equal(capturedPayload.toWibStart, toWibStart(start).toISOString())
  assert.equal(
    capturedPayload.toWibExclusiveEnd,
    toWibExclusiveEnd(end).toISOString()
  )

  await findByText('Job ID: job-123')
  await findByText('2 transaksi settlement diperbarui.')

  assert.equal(apiMock.postCalls.length, 1)
  assert.equal(apiMock.getCalls.length > 0, true)
  assert.equal(apiMock.getCalls[0][0], `${ADJUST_STATUS_PREFIX}job-123`)
})

test('reversal cleanup panel previews and executes cleanup workflow', async () => {
  const defaultRange: [Date, Date] = [
    new Date('2024-05-01T00:00:00Z'),
    new Date('2024-05-03T00:00:00Z'),
  ]
  const toasts: any[] = []
  let capturedPreviewParams: any = null
  let capturedCleanupPayload: any = null

  apiMock.setGetImplementation(async (url: string, config: any) => {
    if (url === CLEANUP_PREVIEW_PATH) {
      capturedPreviewParams = config?.params
      return {
        data: {
          total: 2,
          cleaned: 2,
          failed: [],
          updatedOrderIds: ['order-preview-1', 'order-preview-2'],
          dryRun: true,
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  apiMock.setPostImplementation(async (url: string, payload: any) => {
    if (url === CLEANUP_EXECUTE_PATH) {
      capturedCleanupPayload = payload
      return {
        data: {
          total: 2,
          cleaned: 1,
          failed: [{ orderId: 'order-failed', message: 'cannot update' }],
          updatedOrderIds: ['order-final-1'],
          dryRun: false,
        },
      }
    }
    throw new Error(`Unhandled POST ${url}`)
  })

  const { getByLabelText, getByRole, findByText, queryByText } = render(
    <ReversalCleanupPanel
      subMerchants={[{ id: 'sub-1', name: 'Sub One' }]}
      loadingSubMerchants={false}
      subMerchantError=""
      defaultRange={defaultRange}
      isAdmin={true}
      onToast={toast => toasts.push(toast)}
      apiClient={apiMock as unknown as SettlementAdjustJobControlProps['apiClient']}
    />,
  )

  fireEvent.change(getByLabelText('Sub-merchant (opsional)'), { target: { value: 'sub-1' } })

  fireEvent.click(getByRole('button', { name: 'Preview cleanup' }))

  await findByText('order-preview-1')
  assert.equal(apiMock.getCalls.length, 1)
  assert.equal(apiMock.getCalls[0][0], CLEANUP_PREVIEW_PATH)
  assert.ok(capturedPreviewParams)
  assert.equal(capturedPreviewParams.startDate, '2024-05-01')
  assert.equal(capturedPreviewParams.endDate, '2024-05-03')
  assert.equal(capturedPreviewParams.subMerchantId, 'sub-1')

  fireEvent.click(getByRole('button', { name: 'Jalankan cleanup' }))

  await findByText('order-final-1')
  await findByText('order-failed')
  assert.equal(apiMock.postCalls.length, 1)
  assert.equal(apiMock.postCalls[0][0], CLEANUP_EXECUTE_PATH)
  assert.deepEqual(capturedCleanupPayload, {
    startDate: '2024-05-01',
    endDate: '2024-05-03',
    subMerchantId: 'sub-1',
  })

  assert.equal(queryByText('Ini hanya preview, tidak ada perubahan yang disimpan.'), null)
  assert.equal(toasts.length >= 2, true)
  assert.equal(toasts[0]?.type, 'success')
  assert.equal(toasts[1]?.type, 'success')
})
