process.env.JWT_SECRET = 'test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/service/feeSettlement'

test('computeSettlement calculates fee and net amount', () => {
  const { fee, settlement } = computeSettlement(1000, { percent: 2 })
  assert.equal(fee, 20)
  assert.equal(settlement, 980)
})

test('computeSettlement handles flat fee and precision', () => {
  const { fee, settlement } = computeSettlement(1000, { percent: 1.5, flat: 200 })
  assert.equal(fee, 215)
  assert.equal(settlement, 785)
})

test('computeSettlement handles zero amount', () => {
  const { fee, settlement } = computeSettlement(0, { percent: 2 })
  assert.equal(fee, 0)
  assert.equal(settlement, 0)
})

test('computeSettlement handles negative amount', () => {
  const { fee, settlement } = computeSettlement(-100, { percent: 5 })
  assert.equal(fee, -5)
  assert.equal(settlement, -95)
})
