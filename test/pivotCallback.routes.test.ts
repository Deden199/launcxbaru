process.env.JWT_SECRET = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import pivotCallbackRouter from '../src/route/payment.callback.routes';

test('pivot callback accepts JSON and returns ok', async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/payments', pivotCallbackRouter);

  const res = await request(app)
    .post('/v1/payments/callback/pivot')
    .send({
      event: 'PAYMENT.PAID',
      data: { id: 'pay_123', amount: { value: 1000, currency: 'IDR' }, status: 'PAID' }
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('pivot callback returns error when payment ID is missing', async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/payments', pivotCallbackRouter);

  const res = await request(app)
    .post('/v1/payments/callback/pivot')
    .send({
      event: 'PAYMENT.PAID',
      data: { amount: { value: 1000, currency: 'IDR' }, status: 'PAID' }
    });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    ok: false,
    error: 'Missing payment ID (expected data.id or paymentSessionId)'
  });
});

test('pivot callback handles data.paymentSessionId', async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/payments', pivotCallbackRouter);

  const res = await request(app)
    .post('/v1/payments/callback/pivot')
    .send({
      event: 'PAYMENT.PAID',
      data: { paymentSessionId: 'psess_123', amount: { value: 1000, currency: 'IDR' }, status: 'PAID' }
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('pivot callback handles chargeDetails paymentSessionId', async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/payments', pivotCallbackRouter);

  const res = await request(app)
    .post('/v1/payments/callback/pivot')
    .send({
      event: 'PAYMENT.PAID',
      data: {
        chargeDetails: [{ paymentSessionId: 'psess_789' }],
        amount: { value: 1000, currency: 'IDR' },
        status: 'PAID'
      }
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('pivot callback handles root chargeDetails paymentSessionClientReferenceId', async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/payments', pivotCallbackRouter);

  const res = await request(app)
    .post('/v1/payments/callback/pivot')
    .send({
      event: 'PAYMENT.PAID',
      chargeDetails: [{ paymentSessionClientReferenceId: 'client_ref_123' }]
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('pivot callback accepts eventType field', async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/payments', pivotCallbackRouter);

  const res = await request(app)
    .post('/v1/payments/callback/pivot')
    .send({
      eventType: 'PAYMENT.PAID',
      data: { id: 'pay_456', amount: { value: 2000, currency: 'IDR' }, status: 'PAID' }
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('pivot callback accepts PAYMENT.TEST event by default', async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/payments', pivotCallbackRouter);

  const res = await request(app)
    .post('/v1/payments/callback/pivot')
    .send({
      event: 'PAYMENT.TEST',
      data: { id: 'pay_test', amount: { value: 500, currency: 'IDR' }, status: 'PAID' }
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('pivot callback uses PIVOT_CALLBACK_ALLOWED_EVENTS env var', async () => {
  const original = process.env.PIVOT_CALLBACK_ALLOWED_EVENTS;
  process.env.PIVOT_CALLBACK_ALLOWED_EVENTS = 'PAYMENT.TEST';

  delete require.cache[require.resolve('../src/controller/pivotCallback.controller')];
  delete require.cache[require.resolve('../src/route/payment.callback.routes')];
  const { default: envRouter } = await import('../src/route/payment.callback.routes');

  const app = express();
  app.use(express.json());
  app.use('/v1/payments', envRouter);

  const res = await request(app)
    .post('/v1/payments/callback/pivot')
    .send({
      event: 'PAYMENT.TEST',
      data: { id: 'pay_env', amount: { value: 100, currency: 'IDR' }, status: 'PAID' }
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });

  if (original === undefined) delete process.env.PIVOT_CALLBACK_ALLOWED_EVENTS;
  else process.env.PIVOT_CALLBACK_ALLOWED_EVENTS = original;
});
