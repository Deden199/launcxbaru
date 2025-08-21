process.env.JWT_SECRET = 'test';
process.env.PAYMENT_API_URL = 'https://provider.test';
process.env.PAYMENT_API_KEY = 'key';
process.env.PAYMENT_API_SECRET = 'secret';

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import axios from 'axios';

import paymentRouterV2 from '../src/route/payment.v2.routes';

const app = express();
app.use(express.json());
app.use('/v2/payments', paymentRouterV2);

test('creates card session', async () => {
  const m = mock.method(axios, 'post', async (url, body) => {
    assert.equal(url, 'https://provider.test/v2/payments');
    assert.equal(body.mode, 'API');
    return { data: { id: 'sess1', encryptionKey: 'encKey' } };
  });
  const res = await request(app).post('/v2/payments/session').send({});
  assert.equal(res.status, 201);
  assert.equal(res.body.id, 'sess1');
  assert.equal(res.body.encryptionKey, 'encKey');
  assert.equal(m.mock.callCount(), 1);
  m.mock.restore();
});

test('confirms card session', async () => {
  const m = mock.method(axios, 'post', async (url, body) => {
    assert.equal(url, 'https://provider.test/v2/payments/abc/confirm');
    assert.equal(body.paymentMethod.encryptedCard, 'encrypted');
    return { data: { paymentUrl: 'https://3ds.test' } };
  });
  const res = await request(app)
    .post('/v2/payments/abc/confirm')
    .send({ encryptedCard: 'encrypted' });
  assert.equal(res.status, 200);
  assert.equal(res.body.paymentUrl, 'https://3ds.test');
  m.mock.restore();
});

test('handles provider error', async () => {
  const m = mock.method(axios, 'post', async () => {
    const err: any = new Error('fail');
    err.response = { status: 400, data: { message: 'bad request' } };
    throw err;
  });
  const res = await request(app).post('/v2/payments/session').send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad request');
  m.mock.restore();
});

test('handles confirm error', async () => {
  const m = mock.method(axios, 'post', async () => {
    const err: any = new Error('deny');
    err.response = { status: 402, data: { message: 'payment required' } };
    throw err;
  });
  const res = await request(app)
    .post('/v2/payments/xyz/confirm')
    .send({ encryptedCard: 'enc' });
  assert.equal(res.status, 402);
  assert.equal(res.body.error, 'payment required');
  m.mock.restore();
});
