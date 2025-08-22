process.env.JWT_SECRET = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import pivotCallbackRouter from '../src/route/payment.callback.routes';

test('pivot callback accepts JSON and returns ok', async () => {
  const app = express();
  app.use(express.json());
  app.use('/v2/payments', pivotCallbackRouter);

  const res = await request(app)
    .post('/v2/payments/callback/pivot')
    .send({
      event: 'PAYMENT.PAID',
      data: { id: 'pay_123', amount: { value: 1000, currency: 'IDR' }, status: 'PAID' }
    });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
