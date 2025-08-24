import { test } from 'node:test'
import assert from 'node:assert'
import { buildVolumeSeriesParams } from './dashboard'

test('buildVolumeSeriesParams forces PAID and SETTLED status', () => {
  const params = buildVolumeSeriesParams({ page: 3, limit: 5, status: 'FAILED' }, 'day')
  assert.deepStrictEqual(params.status, ['PAID', 'SETTLED'])
  assert.ok(!('page' in params))
  assert.ok(!('limit' in params))
  assert.equal(params.granularity, 'day')
})
