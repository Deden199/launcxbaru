import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { generateRequestId, generateDynamicQris } from '../src/service/gidi.service';

const baseUrl = 'http://gidi.test/';

test('generateRequestId returns numeric string', () => {
  const id = generateRequestId();
  assert.match(id, /^\d+$/);
});

test('generateDynamicQris regenerates numeric request and transaction ids', async () => {
  let captured: any = null;
  const origCreate = axios.create;
  (axios as any).create = () => ({
    post: async (_url: string, body: any) => {
      captured = body;
      if (!/^\d+$/.test(body.requestId) || !/^\d+$/.test(body.transactionId) || body.requestId === body.transactionId) {
        return { data: { responseCode: 'DOUBLE_REQUEST_ID', responseMessage: 'Double Request Id' } };
      }
      return { data: { responseCode: 'SUCCESS', responseDetail: { rawData: 'dummy' } } };
    },
  });

  const config = {
    baseUrl,
    merchantId: '123',
    subMerchantId: '456',
    requestId: 'abc', // intentionally invalid
    transactionId: 'abc',
    credentialKey: 'secret',
  };

  const outcome = await generateDynamicQris(config, { amount: 1000 });

  assert.equal(outcome.status, 'ready');
  assert.ok(captured);
  assert.match(captured.requestId, /^\d+$/);
  assert.match(captured.transactionId, /^\d+$/);
  assert.notEqual(captured.requestId, captured.transactionId);

  (axios as any).create = origCreate;
});

test('generateDynamicQris sanitizes DOUBLE_REQUEST_ID message', async () => {
  const origCreate = axios.create;
  (axios as any).create = () => ({
    post: async () => ({
      data: {
        responseCode: 'DOUBLE_REQUEST_ID',
        responseMessage: 'Gidi DOUBLE_REQUEST_ID: Double Request Id',
      },
    }),
  });

  const config = {
    baseUrl,
    merchantId: '123',
    subMerchantId: '456',
    credentialKey: 'secret',
  };

  await assert.rejects(
    () => generateDynamicQris(config, { amount: 1000 }),
    (err: any) => {
      assert.equal(err.message, 'Gidi DOUBLE_REQUEST_ID: Double Request Id');
      return true;
    }
  );

  (axios as any).create = origCreate;
});
