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
  clientSecret: 'client-secret',
  signatureKey: 'sig-key',
  merchantId: 'merchant-1',
  deviceId: 'web',
  latitude: '-6.175110',
  longitude: '106.865036',
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

test('authorized headers include MD5 signature metadata', async () => {
  const sample = new Date('2024-03-01T06:30:00.000Z')
  const expectedAuth = piroBasicAuthorization(sample)

  const client = new PiroClient(baseConfig)
  const signature = PiroClient.balanceInquirySignature({
    clientId: baseConfig.clientId,
    deviceId: baseConfig.deviceId!,
    latitude: baseConfig.latitude!,
    longitude: baseConfig.longitude!,
    clientSecret: baseConfig.clientSecret!,
  })
  const headers = await (client as any).authorizedHeaders(sample, { signature })

  assert.equal(headers.Authorization, expectedAuth)
  const encoded = headers.Authorization.replace(/^Basic\s+/, '')
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const { username, password } = piroDailyCredentials(sample)
  assert.equal(decoded, `${username}:${password}`)
  assert.equal(headers.client_id, baseConfig.clientId)
  assert.equal(headers.device_id, baseConfig.deviceId)
  assert.equal(headers.latitude, baseConfig.latitude)
  assert.equal(headers.longitude, baseConfig.longitude)
  assert.equal(headers['x-signature'], signature)
})
