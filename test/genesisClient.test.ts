import test from 'node:test'
import assert from 'node:assert/strict'
import nock from 'nock'

import {
  GenesisClient,
  GenesisClientConfig,
} from '../src/service/genesisClient'

delete process.env.http_proxy
delete process.env.HTTP_PROXY
delete process.env.https_proxy
delete process.env.HTTPS_PROXY

const baseConfig: GenesisClientConfig = {
  baseUrl: 'https://genesis.test',
  secret: 'abc',
  callbackUrl: 'https://merchant.test/callback',
  defaultClientId: 'client-123',
  defaultClientSecret: 'secret-456',
}

nock.disableNetConnect()

test('registrationSignature follows documented pattern', () => {
  const signature = GenesisClient.registrationSignature({
    email: 'susan@linux.id',
    username: 'susan',
    password: 'xABC',
    callbackClient: 'https://genesis.id/callback',
    secret: 'abc',
  })
  assert.equal(signature, '5c98bce40550ec5433fca03e932d0a46')
})

test('generateQris issues request with MD5 signature', async () => {
  const client = new GenesisClient(baseConfig)
  const expectedSignature = GenesisClient.qrisSignature({
    clientId: baseConfig.defaultClientId!,
    value: '10000.00',
    orderId: '171836274993',
    clientSecret: baseConfig.defaultClientSecret!,
  })

  const scope = nock('https://genesis.test')
    .post('/qrissnap2gen/v1/qr-mpm-generate-order', (body) => {
      assert.equal(body.orderId, '171836274993')
      assert.equal(body.value, '10000.00')
      return true
    })
    .matchHeader('x-signature', expectedSignature)
    .matchHeader('client_id', baseConfig.defaultClientId!)
    .reply(201, {
      qrisData: '000201010212...',
      orderId: '171836274993',
      TX: 'gsdbJX1K8ncXuLfxaFeg',
      clientId: baseConfig.defaultClientId,
    })

  const resp = await client.generateQris({ orderId: '171836274993', amount: 10000 })
  assert.equal(resp.orderId, '171836274993')
  assert.equal(resp.tx, 'gsdbJX1K8ncXuLfxaFeg')
  assert.equal(resp.clientId, baseConfig.defaultClientId)
  assert.equal(resp.qrisData, '000201010212...')
  assert.ok(scope.isDone())
  nock.cleanAll()
})

test('queryQris posts orderId with derived signature', async () => {
  const client = new GenesisClient(baseConfig)
  const expectedSignature = GenesisClient.querySignature({
    clientId: baseConfig.defaultClientId!,
    orderId: '1718366184993',
    clientSecret: baseConfig.defaultClientSecret!,
  })

  const scope = nock('https://genesis.test')
    .post('/qrissnap2gen/v1/qr-mpm-query', { orderId: '1718366184993' })
    .matchHeader('x-signature', expectedSignature)
    .reply(200, {
      data: {
        transactionStatusDesc: 'Success',
        responseCode: '2005100',
        amount: { value: '10000.00' },
        paidTime: '2024-07-12T14:50:23+07:00',
      },
      orderId: '1718366184993',
      TX: 'gsdbJX1K8ncXuLfxaFeg',
      clientId: baseConfig.defaultClientId,
    })

  const resp = await client.queryQris({ orderId: '1718366184993' })
  assert.equal(resp.status, 'Success')
  assert.equal(resp.orderId, '1718366184993')
  assert.equal(resp.tx, 'gsdbJX1K8ncXuLfxaFeg')
  assert.equal(resp.clientId, baseConfig.defaultClientId)
  assert.equal(resp.paidTime, '2024-07-12T14:50:23+07:00')
  assert.equal(resp.amount, 10000)
  assert.ok(scope.isDone())
  nock.cleanAll()
})

test('validateCallbackSignature accepts valid Genesis payload', () => {
  const client = new GenesisClient(baseConfig)
  const payload = {
    TX: 'gsdbJX1K8ncXuLfxaFeg',
    amountSend: 10000,
    clientId: baseConfig.defaultClientId,
    orderId: '1718366184993',
    paymentStatus: 'Success',
  }
  const raw = JSON.stringify(payload)
  const signature = GenesisClient.callbackSignature(payload, baseConfig.defaultClientSecret!, payload.clientId)
  const parsed = client.validateCallbackSignature(raw, signature, baseConfig.defaultClientSecret)
  assert.equal(parsed.paymentStatus, 'Success')
  assert.equal(parsed.orderId, '1718366184993')
})
