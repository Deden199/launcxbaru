import test from 'node:test'
import assert from 'node:assert/strict'
import moment from 'moment-timezone'

import {
  jakartaDailyMillis,
  piroBasicAuthorization,
  piroDailyCredentials,
  PiroClient,
  PiroConfig,
} from '../src/service/piroClient'

const baseConfig: PiroConfig = {
  baseUrl: 'https://api.piro.test',
  clientId: 'client-id',
  signatureKey: 'sig-key',
  merchantId: 'merchant-1',
}

test('jakartaDailyMillis aligns with Asia/Jakarta start of day', () => {
  const sample = new Date('2024-05-10T18:42:17.000Z')
  const expected = moment(sample).tz('Asia/Jakarta').startOf('day').valueOf()
  assert.equal(jakartaDailyMillis(sample), expected)
})

test('piroDailyCredentials derives username/password from millis', () => {
  const sample = new Date('2024-08-17T03:00:00.000Z')
  const creds = piroDailyCredentials(sample)
  const expectedMillis = moment(sample).tz('Asia/Jakarta').startOf('day').valueOf()
  assert.equal(creds.millis, expectedMillis)
  assert.equal(creds.username, `piro-${expectedMillis}`)
  assert.equal(creds.password, `${expectedMillis}`)
})

test('authorized headers use Basic auth with daily credentials', async () => {
  const sample = new Date('2024-03-01T06:30:00.000Z')
  const expectedAuth = piroBasicAuthorization(sample)

  const client = new PiroClient(baseConfig)
  const headers = await (client as any).authorizedHeaders(sample)

  assert.equal(headers.Authorization, expectedAuth)
  const encoded = headers.Authorization.replace(/^Basic\s+/, '')
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const { username, password } = piroDailyCredentials(sample)
  assert.equal(decoded, `${username}:${password}`)
})
