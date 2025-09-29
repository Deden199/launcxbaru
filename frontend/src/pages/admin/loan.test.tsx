import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { JSDOM } from 'jsdom'

import { LoanPageView, type LoanPageViewProps, toWibIso } from './loan'

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

const defaultProps: LoanPageViewProps = {
  apiClient: apiMock as unknown as LoanPageViewProps['apiClient'],
}

beforeEach(() => {
  apiMock.reset()
})

afterEach(() => {
  cleanup()
})

test('loads sub-merchant options on mount', async () => {
  apiMock.setGetImplementation(async (url: string) => {
    if (url === '/admin/merchants/all/balances') {
      return {
        data: {
          subBalances: [
            { id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 },
            { id: 'sub-2', name: 'Sub Two', provider: 'oy', balance: 0 },
          ],
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  const { findByLabelText } = render(<LoanPageView {...defaultProps} />)
  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement

  await waitFor(() => {
    assert.equal(select.options.length, 3)
  })

  assert.deepEqual(apiMock.getCalls[0], ['/admin/merchants/all/balances'])
})

test('fetches transactions with WIB date parameters', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  let capturedParams: any = null
  apiMock.setGetImplementation(async (url: string, config?: any) => {
    if (url === '/admin/merchants/all/balances') {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === '/admin/loan/transactions') {
      capturedParams = config?.params
      return {
        data: {
          data: [
            {
              id: 'order-1',
              amount: 10000,
              pendingAmount: 5000,
              status: 'PAID',
              createdAt: new Date('2024-01-02T03:00:00Z').toISOString(),
              loanedAt: null,
              loanAmount: null,
              loanCreatedAt: null,
            },
          ],
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  const { findByLabelText, getByRole, findByText } = render(
    <LoanPageView {...defaultProps} initialRange={[start, end]} />
  )

  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'sub-1' } })

  const loadButton = getByRole('button', { name: 'Muat Transaksi' })
  fireEvent.click(loadButton)

  await findByText('order-1')

  assert.ok(capturedParams)
  assert.equal(capturedParams.subMerchantId, 'sub-1')
  assert.equal(capturedParams.startDate, toWibIso(start))
  assert.equal(capturedParams.endDate, toWibIso(end))
})

test('submits selected transactions to settle API', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  let loanFetchCount = 0
  apiMock.setGetImplementation(async (url: string, config?: any) => {
    if (url === '/admin/merchants/all/balances') {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === '/admin/loan/transactions') {
      loanFetchCount += 1
      if (loanFetchCount === 1) {
        return {
          data: {
            data: [
              {
                id: 'order-1',
                amount: 10000,
                pendingAmount: 5000,
                status: 'PAID',
                createdAt: new Date('2024-01-02T03:00:00Z').toISOString(),
                loanedAt: null,
                loanAmount: null,
                loanCreatedAt: null,
              },
            ],
          },
        }
      }
      return {
        data: {
          data: [
            {
              id: 'order-1',
              amount: 10000,
              pendingAmount: 0,
              status: 'LN_SETTLE',
              createdAt: new Date('2024-01-02T03:00:00Z').toISOString(),
              loanedAt: new Date('2024-01-03T02:00:00Z').toISOString(),
              loanAmount: 5000,
              loanCreatedAt: new Date('2024-01-03T02:00:00Z').toISOString(),
            },
          ],
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  apiMock.setPostImplementation(async () => ({ data: { processed: 1 } }))

  const { findByLabelText, getByRole, findByText } = render(
    <LoanPageView {...defaultProps} initialRange={[start, end]} />
  )

  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'sub-1' } })

  fireEvent.click(getByRole('button', { name: 'Muat Transaksi' }))
  await findByText('order-1')

  const checkbox = await findByLabelText('Pilih transaksi order-1')
  fireEvent.click(checkbox)

  fireEvent.click(getByRole('button', { name: 'Settle Loan' }))

  await waitFor(() => {
    assert.ok(apiMock.postCalls.length > 0)
  })

  assert.deepEqual(apiMock.postCalls[0], [
    '/admin/loan/settle',
    { subMerchantId: 'sub-1', orderIds: ['order-1'] },
  ])

  await waitFor(() => {
    assert.ok(apiMock.getCalls.filter(call => call[0] === '/admin/loan/transactions').length >= 2)
  })
})
