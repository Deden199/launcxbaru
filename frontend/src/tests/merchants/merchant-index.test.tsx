import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { JSDOM } from 'jsdom'
import { PaymentProvidersPageView, type PaymentProvidersPageProps } from '../../pages/admin/merchants/[merchantId]/index'

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

// React 19 requires this flag for testing-library
// @ts-ignore - global property intentionally assigned
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const routerState = { merchantId: 'merchant-123' }

type ApiCall = [string, ...any[]]

type ApiImplementation = (...args: any[]) => Promise<any>

function createApiMock() {
  const apiMock = {
    getCalls: [] as ApiCall[],
    postCalls: [] as ApiCall[],
    patchCalls: [] as ApiCall[],
    _getImpl: (async () => {
      throw new Error('api.get implementation not set')
    }) as ApiImplementation,
    _postImpl: (async () => {
      throw new Error('api.post implementation not set')
    }) as ApiImplementation,
    _patchImpl: (async () => {
      throw new Error('api.patch implementation not set')
    }) as ApiImplementation,
    setGetImplementation(fn: ApiImplementation) {
      apiMock._getImpl = fn
    },
    setPostImplementation(fn: ApiImplementation) {
      apiMock._postImpl = fn
    },
    setPatchImplementation(fn: ApiImplementation) {
      apiMock._patchImpl = fn
    },
    async get(...args: any[]) {
      apiMock.getCalls.push(args as ApiCall)
      return apiMock._getImpl(...args)
    },
    async post(...args: any[]) {
      apiMock.postCalls.push(args as ApiCall)
      return apiMock._postImpl(...args)
    },
    async patch(...args: any[]) {
      apiMock.patchCalls.push(args as ApiCall)
      return apiMock._patchImpl(...args)
    },
    reset() {
      apiMock.getCalls = []
      apiMock.postCalls = []
      apiMock.patchCalls = []
      apiMock._getImpl = (async () => {
        throw new Error('api.get implementation not set')
      }) as ApiImplementation
      apiMock._postImpl = (async () => {
        throw new Error('api.post implementation not set')
      }) as ApiImplementation
      apiMock._patchImpl = (async () => {
        throw new Error('api.patch implementation not set')
      }) as ApiImplementation
    },
  }

  return apiMock
}

const apiMock = createApiMock()

const apiClientMock = apiMock as unknown as PaymentProvidersPageProps['apiClient']

const useRouterStub = () => ({ query: routerState })

const queryFieldByLabel = (root: Element, label: string) => {
  const groups = Array.from(root.querySelectorAll('.form-group'))
  for (const group of groups) {
    const labelEl = group.querySelector('label')
    if (labelEl?.textContent?.trim() === label) {
      return group.querySelector('input, select, textarea') as HTMLElement | null
    }
  }
  return null
}

beforeEach(() => {
  apiMock.reset()
})

afterEach(() => {
  cleanup()
})

test('renders Piro credential fields when provider is selected', async () => {
  apiMock.setGetImplementation(async url => {
    if (url.endsWith('/pg')) {
      return { data: [] }
    }
    return { data: { name: 'Merchant Demo' } }
  })
  apiMock.setPostImplementation(async () => ({ data: {} }))

  const { container, findByRole } = render(
    <PaymentProvidersPageView
      apiClient={apiClientMock}
      useRouterImpl={useRouterStub}
    />
  )

  const addButton = await findByRole('button', { name: '+ Tambah Provider' })
  await waitFor(() => {
    assert.equal((addButton as HTMLButtonElement).hasAttribute('disabled'), false)
  })
  fireEvent.click(addButton)

  await waitFor(() => {
    const modal = container.querySelector('.modal')
    if (!modal) throw new Error('modal not visible')
  })

  const modal = container.querySelector('.modal') as HTMLElement
  const providerSelect = queryFieldByLabel(modal, 'Provider') as HTMLSelectElement
  fireEvent.change(providerSelect, { target: { value: 'piro' } })

  await waitFor(() => {
    assert.equal(providerSelect.value, 'piro')
  })

  assert.ok(queryFieldByLabel(modal, 'Merchant ID'))
  assert.ok(queryFieldByLabel(modal, 'Store ID'))
  assert.ok(queryFieldByLabel(modal, 'Terminal ID'))
  assert.ok(queryFieldByLabel(modal, 'Channel'))
  assert.ok(queryFieldByLabel(modal, 'Callback URL (opsional)'))
})

test('submits a new Piro sub-merchant entry with trimmed credentials', async () => {
  apiMock.setGetImplementation(async url => {
    if (url.endsWith('/pg')) {
      return { data: [] }
    }
    return { data: { name: 'Merchant Demo' } }
  })
  apiMock.setPostImplementation(async () => ({ data: { id: 'new-id' } }))

  const initialForm = {
    provider: 'piro',
    name: ' Piro Demo ',
    credentials: {
      merchantId: '  merchant-999  ',
      storeId: ' store-888 ',
      terminalId: ' terminal-777 ',
      channel: ' channel-online ',
      callbackUrl: ' https://callback.example ',
    },
    schedule: { weekday: true, weekend: false },
  } satisfies NonNullable<PaymentProvidersPageProps['initialForm']>

  const { container: container2, getByRole } = render(
    <PaymentProvidersPageView
      apiClient={apiClientMock}
      useRouterImpl={useRouterStub}
      initialForm={initialForm}
      initialShowForm
    />
  )

  await waitFor(() => {
    const modalEl = container2.querySelector('.modal')
    if (!modalEl) throw new Error('modal not visible')
  })

  const saveButton = getByRole('button', { name: 'Simpan' })
  await act(async () => {
    fireEvent.click(saveButton)
  })

  await waitFor(() => {
    const errorBanner = container2.querySelector('.error-banner')
    if (errorBanner) {
      throw new Error(`form error: ${errorBanner.textContent}`)
    }
    assert.equal(apiMock.postCalls.length, 1)
  })

  const [url, payload] = apiMock.postCalls[0]
  assert.equal(url, '/admin/merchants/merchant-123/pg')
  assert.equal(payload.provider, 'piro')
  assert.equal(payload.name, 'Piro Demo')
  assert.deepEqual(payload.schedule, { weekday: true, weekend: false })
  assert.deepEqual(payload.credentials, {
    merchantId: 'merchant-999',
    storeId: 'store-888',
    terminalId: 'terminal-777',
    channel: 'channel-online',
    callbackUrl: 'https://callback.example',
  })
})
