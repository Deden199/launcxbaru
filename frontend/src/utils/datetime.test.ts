import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { formatDateTimeInWIB } from './datetime'

describe('formatDateTimeInWIB', () => {
  it('formats ISO strings using Asia/Jakarta timezone', () => {
    const formatted = formatDateTimeInWIB('2024-01-15T03:04:05Z')
    assert.equal(formatted, '15 Jan 2024, 10.04.05 WIB')
  })

  it('returns a placeholder for invalid input', () => {
    const formatted = formatDateTimeInWIB('invalid-date')
    assert.equal(formatted, '—')
  })
})
