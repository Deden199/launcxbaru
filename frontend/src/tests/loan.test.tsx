import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JSDOM } from 'jsdom'

import {
  LoanPageView,
  type LoanPageViewProps,
  toWibIso,
  DEFAULT_LOAN_PAGE_SIZE,
} from '../pages/admin/loan'

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

if (!window.attachEvent) {
  // @ts-ignore legacy support for React polyfills in tests
  window.attachEvent = () => {}
}
if (!window.detachEvent) {
  // @ts-ignore legacy support for React polyfills in tests
  window.detachEvent = () => {}
}
if (!(HTMLElement.prototype as any).attachEvent) {
  // @ts-ignore legacy support for React polyfills in tests
  ;(HTMLElement.prototype as any).attachEvent = () => {}
}
if (!(HTMLElement.prototype as any).detachEvent) {
  // @ts-ignore legacy support for React polyfills in tests
  ;(HTMLElement.prototype as any).detachEvent = () => {}
}

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
const BALANCES_PATH = '/admin/merchants/all/balances'
const LOAN_TRANSACTIONS_PATH = '/admin/merchants/loan/transactions'
const LOAN_MARK_SETTLED_PATH = '/admin/merchants/loan/mark-settled'
const LOAN_MARK_SETTLED_RANGE_START_PATH =
  '/admin/merchants/loan/mark-settled/by-range/start'
const LOAN_MARK_SETTLED_STATUS_PREFIX =
  '/admin/merchants/loan/mark-settled/by-range/status/'
const LOAN_REVERT_RANGE_PATH = '/admin/merchants/loan/revert/by-range'

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
    if (url === BALANCES_PATH) {
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

  assert.deepEqual(apiMock.getCalls[0], [BALANCES_PATH])
})

test('fetches transactions with WIB date parameters', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  let capturedParams: any = null
  apiMock.setGetImplementation(async (url: string, config?: any) => {
    if (url === BALANCES_PATH) {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === LOAN_TRANSACTIONS_PATH) {
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
          meta: { total: 1, page: 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
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

  const pageSizeSelect = (await findByLabelText('Jumlah per permintaan')) as HTMLSelectElement
  assert.equal(pageSizeSelect.value, DEFAULT_LOAN_PAGE_SIZE.toString())

  const loadButton = getByRole('button', { name: 'Muat Transaksi' })
  fireEvent.click(loadButton)

  await findByText('order-1')

  assert.ok(capturedParams)
  assert.equal(capturedParams.subMerchantId, 'sub-1')
  assert.equal(capturedParams.startDate, toWibIso(start))
  assert.equal(capturedParams.endDate, toWibIso(end))
  assert.equal(capturedParams.page, 1)
  assert.equal(capturedParams.pageSize, DEFAULT_LOAN_PAGE_SIZE)
})

test('submits selected transactions to settle API', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  let loanFetchCount = 0
  apiMock.setGetImplementation(async (url: string, config?: any) => {
    if (url === BALANCES_PATH) {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === LOAN_TRANSACTIONS_PATH) {
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
            meta: { total: 1, page: 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
          },
        }
      }
      return {
        data: {
          data: [],
          meta: { total: 0, page: 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  let capturedPayload: any = null
  apiMock.setPostImplementation(async (_url: string, payload: any) => {
    capturedPayload = { ...payload }
    if (payload.note) {
      capturedPayload.note = payload.note
    }
    assert.equal(payload.note, 'Manual adjustment')
    return { data: { ok: payload.orderIds ?? [], fail: [], errors: [] } }
  })

  const { findByLabelText, getByRole, findByText } = render(
    <LoanPageView {...defaultProps} initialRange={[start, end]} />
  )

  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'sub-1' } })

  fireEvent.click(getByRole('button', { name: 'Muat Transaksi' }))
  await findByText('order-1')

  const noteField = (await findByLabelText('Catatan (opsional)')) as HTMLTextAreaElement
  fireEvent.change(noteField, { target: { value: 'Manual adjustment ' } })
  await waitFor(() => {
    assert.equal(noteField.value, 'Manual adjustment ')
  })

  const checkbox = await findByLabelText('Pilih transaksi order-1')
  fireEvent.click(checkbox)
  await waitFor(() => {
    assert.equal(noteField.value, 'Manual adjustment ')
  })

  fireEvent.click(getByRole('button', { name: 'Tandai Loan Settled (1)' }))

  await waitFor(() => {
    assert.ok(apiMock.postCalls.length > 0)
  })

  await waitFor(() => {
    assert.equal(capturedPayload?.note, 'Manual adjustment')
  })

  assert.deepEqual(apiMock.postCalls[0][0], LOAN_MARK_SETTLED_PATH)
  assert.deepEqual(capturedPayload, { orderIds: ['order-1'], note: 'Manual adjustment' })

  await waitFor(() => {
    assert.equal(noteField.value, '')
  })

  await waitFor(() => {
    assert.ok(
      apiMock.getCalls.filter(call => call[0] === LOAN_TRANSACTIONS_PATH).length >= 2,
    )
  })
})

test('starts loan settlement job and polls until completion', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  let loanFetchCount = 0
  let statusCallCount = 0
  const statusResponses = [
    {
      status: 'completed' as const,
      summary: {
        ok: ['order-1', 'order-2'],
        fail: ['order-3'],
        errors: [{ orderId: 'order-3', message: 'Sudah settled' }],
      },
    },
  ]

  apiMock.setGetImplementation(async (url: string, config?: any) => {
    if (url === BALANCES_PATH) {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === LOAN_TRANSACTIONS_PATH) {
      loanFetchCount += 1
      return {
        data: {
          data: [],
          meta: {
            total: 0,
            page: config?.params?.page ?? 1,
            pageSize: DEFAULT_LOAN_PAGE_SIZE,
          },
        },
      }
    }
    if (url.startsWith(LOAN_MARK_SETTLED_STATUS_PREFIX)) {
      const response =
        statusResponses[Math.min(statusCallCount, statusResponses.length - 1)]
      statusCallCount += 1
      return {
        data: {
          jobId: 'job-123',
          status: response.status,
          summary: response.summary,
          error: null,
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  let capturedPayload: any = null
  apiMock.setPostImplementation(async (url: string, payload: any) => {
    if (url === LOAN_MARK_SETTLED_RANGE_START_PATH) {
      capturedPayload = { ...payload }
      return { data: { jobId: 'job-123' } }
    }
    throw new Error(`Unhandled POST ${url}`)
  })

  const { findByLabelText, getByRole, findByText } = render(
    <LoanPageView {...defaultProps} initialRange={[start, end]} />,
  )

  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'sub-1' } })

  const noteField = (await findByLabelText('Catatan (opsional)')) as HTMLTextAreaElement
  fireEvent.change(noteField, { target: { value: ' Bulk job ' } })

  const startButton = getByRole('button', { name: 'Mulai Penandaan Rentang' })
  fireEvent.click(startButton)

  await waitFor(() => {
    assert.equal(apiMock.postCalls.length, 1)
  })

  assert.equal(apiMock.postCalls[0][0], LOAN_MARK_SETTLED_RANGE_START_PATH)
  assert.ok(capturedPayload)
  assert.deepEqual(capturedPayload, {
    subMerchantId: 'sub-1',
    startDate: toWibIso(start),
    endDate: toWibIso(end),
    dryRun: false,
    note: 'Bulk job',
  })

  await findByText('Berhasil menandai 2 transaksi sebagai loan-settled.', undefined, {
    timeout: 5000,
  })
  await findByText('Gagal menandai 1 transaksi: order-3: Sudah settled', undefined, {
    timeout: 5000,
  })
  const statusLabel = await findByText('Status job', undefined, { timeout: 5000 })
  await findByText('Selesai', undefined, { timeout: 5000 })

  const summaryContainer = statusLabel.parentElement?.parentElement
  const summaryTexts = Array.from(summaryContainer?.querySelectorAll('span') ?? []).map(span =>
    span.textContent?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
  )

  assert.ok(summaryTexts.includes('Berhasil: 2'))
  assert.ok(summaryTexts.includes('Gagal: 1'))

  await waitFor(
    () => {
      assert.ok(
        apiMock.getCalls.some(call =>
          String(call[0]).startsWith(LOAN_MARK_SETTLED_STATUS_PREFIX),
        ),
      )
    },
    { timeout: 5000 },
  )

  await waitFor(
    () => {
      assert.ok(loanFetchCount >= 1)
      assert.ok(statusCallCount >= 1)
    },
    { timeout: 5000 },
  )
})

test('reverts selected loan-settled transactions with manual order IDs', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  let loanFetchCount = 0
  apiMock.setGetImplementation(async (url: string) => {
    if (url === BALANCES_PATH) {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === LOAN_TRANSACTIONS_PATH) {
      loanFetchCount += 1
      if (loanFetchCount === 1) {
        return {
          data: {
            data: [
              {
                id: 'order-1',
                amount: 10000,
                pendingAmount: 2000,
                status: 'PAID',
                createdAt: new Date('2024-01-02T01:00:00Z').toISOString(),
                loanedAt: null,
                loanAmount: null,
                loanCreatedAt: null,
              },
              {
                id: 'order-ls-1',
                amount: 15000,
                pendingAmount: 0,
                status: 'LN_SETTLED',
                createdAt: new Date('2024-01-02T02:00:00Z').toISOString(),
                loanedAt: new Date('2024-01-02T02:30:00Z').toISOString(),
                loanAmount: 15000,
                loanCreatedAt: new Date('2024-01-02T02:35:00Z').toISOString(),
              },
            ],
            meta: { total: 2, page: 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
          },
        }
      }
      return {
        data: {
          data: [
            {
              id: 'order-1',
              amount: 10000,
              pendingAmount: 2000,
              status: 'PAID',
              createdAt: new Date('2024-01-02T01:00:00Z').toISOString(),
              loanedAt: null,
              loanAmount: null,
              loanCreatedAt: null,
            },
          ],
          meta: { total: 1, page: 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  let capturedPayload: any = null
  apiMock.setPostImplementation(async (url: string, payload: any) => {
    if (url === LOAN_REVERT_RANGE_PATH) {
      capturedPayload = { ...payload }
      return {
        data: {
          ok: payload.orderIds ?? [],
          fail: [],
          errors: [],
          events: ['audit-log'],
        },
      }
    }
    throw new Error(`Unhandled POST ${url}`)
  })

  const { findByLabelText, getByRole, findByText } = render(
    <LoanPageView {...defaultProps} initialRange={[start, end]} />,
  )

  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'sub-1' } })

  fireEvent.click(getByRole('button', { name: 'Muat Transaksi' }))
  await findByText('order-1')

  const revertModeButton = getByRole('button', { name: 'Revert Loan Settled' })
  fireEvent.click(revertModeButton)

  const revertCheckbox = await findByLabelText('Pilih transaksi order-ls-1')
  fireEvent.click(revertCheckbox)

  const manualField = (await findByLabelText('Order ID manual (opsional)')) as HTMLTextAreaElement
  const user = userEvent.setup({ document: window.document })
  await user.type(manualField, 'order-extra-1')

  await waitFor(() => {
    assert.ok(manualField.value.includes('order-extra-1'))
  })

  const noteField = (await findByLabelText('Catatan (opsional)')) as HTMLTextAreaElement
  fireEvent.change(noteField, { target: { value: '  Revert adjust  ' } })

  await waitFor(() => {
    assert.equal(noteField.value, '  Revert adjust  ')
  })

  const revertButton = getByRole('button', { name: /Revert Transaksi/ })
  fireEvent.click(revertButton)

  await waitFor(() => {
    assert.equal(apiMock.postCalls.length, 1)
  })

  assert.equal(apiMock.postCalls[0][0], LOAN_REVERT_RANGE_PATH)
  assert.ok(capturedPayload)
  assert.deepEqual(capturedPayload.orderIds, ['order-ls-1', 'order-extra-1'])
  assert.equal(capturedPayload.note, 'Revert adjust')
  assert.equal(capturedPayload.subMerchantId, 'sub-1')
  assert.equal(capturedPayload.startDate, toWibIso(start))
  assert.equal(capturedPayload.endDate, toWibIso(end))
  assert.ok(!capturedPayload.exportOnly)

  await findByText(/Berhasil merevert 2 transaksi loan-settled/, undefined, {
    timeout: 5000,
  })

  await waitFor(() => {
    assert.equal(manualField.value, '')
  })

  await waitFor(() => {
    assert.equal(noteField.value, '')
  })

  await waitFor(
    () => {
      assert.ok(loanFetchCount >= 2)
    },
    { timeout: 5000 },
  )
})

test('export-only revert downloads CSV file', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  let loanFetchCount = 0
  apiMock.setGetImplementation(async (url: string) => {
    if (url === BALANCES_PATH) {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === LOAN_TRANSACTIONS_PATH) {
      loanFetchCount += 1
      return {
        data: {
          data: [
            {
              id: 'order-ls-2',
              amount: 5000,
              pendingAmount: 0,
              status: 'LN_SETTLED',
              createdAt: new Date('2024-01-02T04:00:00Z').toISOString(),
              loanedAt: new Date('2024-01-02T04:30:00Z').toISOString(),
              loanAmount: 5000,
              loanCreatedAt: new Date('2024-01-02T04:35:00Z').toISOString(),
            },
          ],
          meta: { total: 1, page: 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  let capturedPayload: any = null
  apiMock.setPostImplementation(async (url: string, payload: any) => {
    if (url === LOAN_REVERT_RANGE_PATH) {
      capturedPayload = { ...payload }
      return {
        data: {
          exportFile: {
            data: Buffer.from('orderId,status').toString('base64'),
            mimeType: 'text/csv',
            fileName: 'loan-revert.csv',
          },
          ok: [],
          fail: [],
          errors: [],
          events: ['exported'],
        },
      }
    }
    throw new Error(`Unhandled POST ${url}`)
  })

  const originalClick = window.HTMLAnchorElement.prototype.click
  const urlAny = window.URL as unknown as {
    createObjectURL?: (...args: any[]) => string
    revokeObjectURL?: (...args: any[]) => void
  }
  const originalCreateObjectURL = urlAny.createObjectURL
  const originalRevokeObjectURL = urlAny.revokeObjectURL
  let downloadTriggered = 0
  window.HTMLAnchorElement.prototype.click = function click() {
    downloadTriggered += 1
  }
  urlAny.createObjectURL = () => 'blob:mock-url'
  urlAny.revokeObjectURL = () => {}

  try {
    const { findByLabelText, getByRole, findByText } = render(
      <LoanPageView {...defaultProps} initialRange={[start, end]} />,
    )

    const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'sub-1' } })

    fireEvent.click(getByRole('button', { name: 'Muat Transaksi' }))
    await findByText('Tidak ada data untuk filter saat ini.')

    const revertModeButton = getByRole('button', { name: 'Revert Loan Settled' })
    fireEvent.click(revertModeButton)

    const manualField = (await findByLabelText('Order ID manual (opsional)')) as HTMLTextAreaElement
    const user = userEvent.setup({ document: window.document })
    await user.type(manualField, 'order-extra-9')

    await waitFor(() => {
      assert.ok(manualField.value.includes('order-extra-9'))
    })

    const revertCheckbox = await findByLabelText('Pilih transaksi order-ls-2')
    fireEvent.click(revertCheckbox)

    await findByText('order-ls-2')

    const exportButton = getByRole('button', { name: /Ekspor Saja/ })
    fireEvent.click(exportButton)

    await waitFor(() => {
      assert.equal(apiMock.postCalls.length, 1)
    })

    assert.equal(apiMock.postCalls[0][0], LOAN_REVERT_RANGE_PATH)
    assert.ok(capturedPayload)
    assert.equal(capturedPayload.exportOnly, true)
    assert.deepEqual(capturedPayload.orderIds, ['order-ls-2', 'order-extra-9'])

    await findByText(/Berhasil menyiapkan ekspor/, undefined, { timeout: 5000 })

    assert.ok(downloadTriggered > 0)
    assert.equal(loanFetchCount, 1)
  } finally {
    window.HTMLAnchorElement.prototype.click = originalClick
    if (originalCreateObjectURL) {
      urlAny.createObjectURL = originalCreateObjectURL
    } else {
      delete urlAny.createObjectURL
    }
    if (originalRevokeObjectURL) {
      urlAny.revokeObjectURL = originalRevokeObjectURL
    } else {
      delete urlAny.revokeObjectURL
    }
  }
})

test('bulk settle submits every selectable order id', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  apiMock.setGetImplementation(async (url: string) => {
    if (url === BALANCES_PATH) {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === LOAN_TRANSACTIONS_PATH) {
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
            {
              id: 'order-2',
              amount: 20000,
              pendingAmount: 20000,
              status: 'SUCCESS',
              createdAt: new Date('2024-01-02T04:00:00Z').toISOString(),
              loanedAt: null,
              loanAmount: null,
              loanCreatedAt: null,
            },
          ],
          meta: { total: 2, page: 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  apiMock.setPostImplementation(async (_url: string, payload: any) => ({
    data: { ok: payload.orderIds ?? [], fail: [], errors: [] },
  }))

  const { findByLabelText, getByRole, findByText, findByRole } = render(
    <LoanPageView {...defaultProps} initialRange={[start, end]} />
  )

  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'sub-1' } })

  fireEvent.click(getByRole('button', { name: 'Muat Transaksi' }))
  await findByText('order-1')
  await findByText('order-2')

  const toggleAll = (await findByLabelText(
    'Pilih semua transaksi PAID/SUCCESS/DONE/SETTLED'
  )) as HTMLInputElement
  const successCheckbox = (await findByLabelText('Pilih transaksi order-2')) as HTMLInputElement
  assert.equal(successCheckbox.disabled, false)
  fireEvent.click(toggleAll)
  assert.equal(successCheckbox.checked, true)

  const settleButton = await findByRole('button', { name: 'Tandai Loan Settled (2)' })
  fireEvent.click(settleButton)

  await waitFor(() => {
    assert.equal(apiMock.postCalls.length, 1)
  })

  const [postUrl, payload] = apiMock.postCalls[0]
  assert.equal(postUrl, LOAN_MARK_SETTLED_PATH)
  assert.deepEqual(payload, {
    orderIds: ['order-1', 'order-2'],
  })
})

test('allows loading additional loan transaction pages', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  let lastParams: any = null
  apiMock.setGetImplementation(async (url: string, config?: any) => {
    if (url === BALANCES_PATH) {
      return { data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] } }
    }
    if (url === LOAN_TRANSACTIONS_PATH) {
      lastParams = config?.params
      if (config?.params?.page === 1) {
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
            meta: { total: 2, page: 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
          },
        }
      }
      return {
        data: {
          data: [
            {
              id: 'order-2',
              amount: 20000,
              pendingAmount: 0,
              status: 'PAID',
              createdAt: new Date('2024-01-02T05:00:00Z').toISOString(),
              loanedAt: new Date('2024-01-02T06:00:00Z').toISOString(),
              loanAmount: 20000,
              loanCreatedAt: new Date('2024-01-02T06:00:00Z').toISOString(),
            },
          ],
          meta: { total: 2, page: 2, pageSize: DEFAULT_LOAN_PAGE_SIZE },
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  const { findByLabelText, getByRole, findByText, queryByRole } = render(
    <LoanPageView {...defaultProps} initialRange={[start, end]} />,
  )

  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'sub-1' } })

  fireEvent.click(getByRole('button', { name: 'Muat Transaksi' }))
  await findByText('order-1')

  const loadMoreButton = getByRole('button', { name: 'Muat Lebih' })
  fireEvent.click(loadMoreButton)

  await findByText('order-2')
  assert.equal(lastParams.page, 2)
  assert.equal(lastParams.pageSize, DEFAULT_LOAN_PAGE_SIZE)
  await waitFor(() => {
    assert.equal(queryByRole('button', { name: 'Muat Lebih' }), null)
  })
})

test('does not render loan-settled transactions in the table', async () => {
  const start = new Date('2024-01-02T00:00:00Z')
  const end = new Date('2024-01-03T00:00:00Z')

  apiMock.setGetImplementation(async (url: string, config?: any) => {
    if (url === BALANCES_PATH) {
      return {
        data: { subBalances: [{ id: 'sub-1', name: 'Sub One', provider: 'oy', balance: 0 }] },
      }
    }
    if (url === LOAN_TRANSACTIONS_PATH) {
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
            {
              id: 'order-2',
              amount: 20000,
              pendingAmount: 0,
              status: 'LN_SETTLED',
              createdAt: new Date('2024-01-02T04:00:00Z').toISOString(),
              loanedAt: null,
              loanAmount: null,
              loanCreatedAt: null,
            },
          ],
          meta: { total: 2, page: config?.params?.page ?? 1, pageSize: DEFAULT_LOAN_PAGE_SIZE },
        },
      }
    }
    throw new Error(`Unhandled GET ${url}`)
  })

  const { findByLabelText, getByRole, findByText, queryByText } = render(
    <LoanPageView {...defaultProps} initialRange={[start, end]} />
  )

  const select = (await findByLabelText('Sub-merchant')) as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'sub-1' } })

  fireEvent.click(getByRole('button', { name: 'Muat Transaksi' }))

  await findByText('order-1')
  assert.equal(queryByText('order-2'), null)
})
