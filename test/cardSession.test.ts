process.env.JWT_SECRET = 'test';
process.env.PAYMENT_API_URL = 'https://provider.test';
process.env.PAYMENT_API_KEY = 'key';
process.env.PAYMENT_API_SECRET = 'secret';
process.env.FRONTEND_BASE_URL = 'https://merchant.test/';
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
delete process.env.npm_config_http_proxy;
delete process.env.npm_config_https_proxy;
delete process.env.npm_config_proxy;

import test from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import express from 'express';
import request from 'supertest';

import paymentRouterV2 from '../src/route/payment.v2.routes';

nock.disableNetConnect();
nock.enableNetConnect('127.0.0.1');

const app = express();
app.use(express.json());
app.use('/v2/payments', paymentRouterV2);

test('creates card session', async () => {
  const payload = {
    amount: 1000,
    currency: 'IDR',
    customer: { email: 'john@example.com' },
    order: { referenceId: 'order1' },
  };

  nock('https://provider.test')
    .post('/v2/payments', body => {
      assert.equal(body.mode, 'API');
      assert.equal(body.amount, payload.amount);
      assert.equal(body.currency, payload.currency);
      assert.equal(body.customer.email, payload.customer.email);
      assert.equal(body.order.referenceId, payload.order.referenceId);
      assert.equal(body.successReturnUrl, 'https://merchant.test/payment-success');
      assert.equal(body.failureReturnUrl, 'https://merchant.test/payment-failure');
      assert.equal(body.expirationReturnUrl, 'https://merchant.test/payment-expired');
      return true;
    })
    .reply(201, { id: 'sess1', encryptionKey: 'encKey' });

  const res = await request(app).post('/v2/payments/session').send(payload);

  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 'sess1', encryptionKey: 'encKey' });
  assert.ok(nock.isDone());
  nock.cleanAll();
});

test('confirms card session', async () => {
  nock('https://provider.test')
    .post('/v2/payments/abc/confirm', body => {
      assert.equal(body.paymentMethod.card.encryptedCard, 'encrypted');
      return true;
    })
    .reply(200, { paymentUrl: 'https://3ds.test' });

  const res = await request(app)
    .post('/v2/payments/abc/confirm')
    .send({ encryptedCard: 'encrypted' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { paymentUrl: 'https://3ds.test' });
  assert.ok(nock.isDone());
  nock.cleanAll();
});

test('rejects invalid encryptedCard', async () => {
  const res = await request(app)
    .post('/v2/payments/abc/confirm')
    .send({ encryptedCard: '' });

  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.errors));
});

test('handles provider error on session creation', async () => {
  nock('https://provider.test')
    .post('/v2/payments')
    .reply(400, { message: 'bad request' });

  const payload = { amount: 1000, currency: 'IDR' };
  const res = await request(app).post('/v2/payments/session').send(payload);

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad request');
  assert.ok(nock.isDone());
  nock.cleanAll();
});

test('handles provider error on confirmation', async () => {
  nock('https://provider.test')
    .post('/v2/payments/xyz/confirm')
    .reply(402, { message: 'payment required' });

  const res = await request(app)
    .post('/v2/payments/xyz/confirm')
    .send({ encryptedCard: 'enc' });

  assert.equal(res.status, 402);
  assert.equal(res.body.error, 'payment required');
  assert.ok(nock.isDone());
  nock.cleanAll();
});
