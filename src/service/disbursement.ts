// src/service/disbursement.ts

import axios from 'axios';
import crypto from 'crypto';
import { Request } from 'express';
import { prisma } from '../core/prisma';
import logger from '../logger';
import { DisbursementStatus } from '@prisma/client';
import {
  DisbursementRequest,
  DisbursementResponse,
  DisbursementStatusResponse,
  AccountDetailsResponse,
} from '../schema/types/disbursement';
import { config } from '../config';

// Ambil konfigurasi Hilogate dari config.api.hilogate
const {
  baseUrl:    BASE_URL,
  merchantId: MERCHANT_ID,
  secretKey:  SECRET_KEY,
  env:        ENVIRONMENT,
} = config.api.hilogate;

// Helper: buat MD5 signature sesuai dokumentasi Hilogate
function makeSignature(path: string, body?: any): string {
  const payload = body ? JSON.stringify(body) : '';
  const raw = body
    ? `${path}${payload}${SECRET_KEY}`
    : `${path}${SECRET_KEY}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

export default {
  // Kirim permintaan withdrawal (disbursement) ke Hilogate
  async createDisbursement(args: DisbursementRequest): Promise<DisbursementResponse> {
    const path = '/api/v1/withdrawals';
    const url  = `${BASE_URL}${path}`;

    const body = {
      ref_id:             args.requestId,
      account_name:       args.recipientName || '',
      account_name_alias: (args.recipientNameAlias ?? args.recipientName) || '',
      account_number:     args.recipientAccount,
      amount:             args.amount,
      bank_code:          args.bankCode,
      bank_name:          args.bankName || '',
      branch_name:        args.branchName ?? null,
      description:        args.description ?? null,
    };

    const headers = {
      'Content-Type':  'application/json',
      'X-Merchant-ID': MERCHANT_ID,
      'X-Environment': ENVIRONMENT,
      'X-Signature':   makeSignature(path, body),
    };

    const { data: resp } = await axios.post(url, body, { headers });
    const d = resp.data;

    return {
      disbursementId:   d.id,
      status:           d.status,
      amount:           d.amount,
      recipientAccount: d.account_number,
      bankCode:         d.bank_code,
      currency:         d.currency,
      description:      d.description ?? null,
      requestId:        d.ref_id,
    };
  },

  // Cek status withdrawal
  async getDisbursementStatus(id: string): Promise<DisbursementStatusResponse> {
    const path = `/api/v1/withdrawals/${id}`;
    const url  = `${BASE_URL}${path}`;

    const headers = {
      'X-Merchant-ID': MERCHANT_ID,
      'X-Environment': ENVIRONMENT,
      'X-Signature':   makeSignature(path),
    };

    const { data: resp } = await axios.get(url, { headers });
    const d = resp.data;

    return {
      disbursementId:   d.id,
      status:           d.status,
      amount:           d.amount,
      recipientAccount: d.account_number,
      bankCode:         d.bank_code,
      currency:         d.currency,
      description:      d.description ?? null,
      requestId:        d.ref_id,
    };
  },

  async getBalance(): Promise<{ active_balance: number; pending_balance: number }> {
    const path = '/api/v1/balance';
    const url  = `${BASE_URL}${path}`;
    const headers = {
      'X-Merchant-ID': MERCHANT_ID,
      'X-Environment': ENVIRONMENT,
      'X-Signature':   makeSignature(path),
    };
    const { data: resp } = await axios.get(url, { headers });
    // resp.data sesuai docs: { active_balance, pending_balance, … }
    return {
      active_balance:  resp.data.active_balance,
      pending_balance: resp.data.pending_balance,
    };
  },
  // Validasi account sebelum disbursement
  async checkAccount(bankCode: string, accountNumber: string): Promise<AccountDetailsResponse> {
    const path = '/api/v1/bank-accounts/validate';
    const url  = `${BASE_URL}${path}`;
    const body = { bank_code: bankCode, account_number: accountNumber };

    const headers = {
      'Content-Type':  'application/json',
      'X-Merchant-ID': MERCHANT_ID,
      'X-Environment': ENVIRONMENT,
      'X-Signature':   makeSignature(path, body),
    };

    const { data: resp } = await axios.post(url, body, { headers });
    const d = resp.data;

    return {
      accountNumber: d.account_number,
      bankCode:      d.bank_code,
      accountName:   d.account_name,
    };
  },

  // Tangani callback Hilogate
  async transactionCallback(req: Request) {
    const bodyStr  = JSON.stringify(req.body);
    const sig      = req.headers['x-signature'] as string;
    const expected = crypto.createHash('md5').update(bodyStr + SECRET_KEY).digest('hex');

    if (!sig || sig !== expected) {
      logger.error('Invalid signature callback');
      throw new Error('Invalid signature');
    }

    const payload    = req.body;
    const referenceId = payload.ref_id;

    await prisma.disbursement_callback.create({
      data: { referenceId, requestBody: payload },
    });

    await prisma.disbursement.update({
      where: { id: referenceId },
      data:  { status: DisbursementStatus.COMPLETED },
    });

    logger.info(`Disbursement ${referenceId} selesai`);
  },
};
