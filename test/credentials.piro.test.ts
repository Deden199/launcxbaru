import test from 'node:test'
import assert from 'node:assert/strict'

import { parseRawCredential, normalizeCredentials } from '../src/util/credentials'

test('normalizeCredentials maps Piro aliases and trims values', () => {
  const raw = parseRawCredential('piro', {
    merchant_id: '  MID-123  ',
    storeID: ' Store-1 ',
    terminal_id: ' TERM-9 ',
    channelCode: ' CHANNEL ',
    callbackURL: 'https://callback.test',
  })

  const normalized = normalizeCredentials('piro', raw)

  assert.deepEqual(normalized, {
    provider: 'piro',
    merchantId: 'MID-123',
    storeId: 'Store-1',
    terminalId: 'TERM-9',
    channel: 'CHANNEL',
    callbackUrl: 'https://callback.test',
  })
})

test('normalizeCredentials rejects incomplete Piro credentials', () => {
  const raw = parseRawCredential('piro', { storeId: 'store-only' })

  assert.throws(() => normalizeCredentials('piro', raw), (error: any) => {
    assert.equal(error?.name, 'ZodError')
    return true
  })
})
