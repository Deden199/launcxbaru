import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { JSDOM } from 'jsdom'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

import {
  SettlementAdjustJobControl,
  type SettlementAdjustJobControlProps,
  toWibExclusiveEnd,
  toWibStart,
} from '../pages/admin/settlement-adjust'

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

const ADJUST_JOB_PATH = '/admin/settlement/adjust/job'
const ADJUST_STATUS_PREFIX = '/admin/settlement/adjust/status/'

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
