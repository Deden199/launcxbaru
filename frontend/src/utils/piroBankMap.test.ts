import { test } from 'node:test'
import assert from 'node:assert'
import { resolvePiroBankMeta } from './piroBankMap'

test('resolvePiroBankMeta maps known aliases', () => {
  const meta = resolvePiroBankMeta('Bank Mandiri', '999')
  assert.equal(meta.bankCode, '008')
  assert.equal(meta.branchCode, '0080010')
  assert.equal(meta.bankIdentifier, 'BMRIIDJA')
})

test('resolvePiroBankMeta falls back to provided code', () => {
  const meta = resolvePiroBankMeta('Bank Tidak Ada', '123')
  assert.equal(meta.bankCode, '123')
  assert.equal(meta.branchCode, '1230001')
  assert.equal(meta.bankIdentifier, '123')
})
