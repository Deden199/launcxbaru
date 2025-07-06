import axios from 'axios';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface CreateEwalletParams {
  merchantId:    string;
  subMerchantId: string;
  buyerId:       string;
  partnerTrxId:  string;
  amount:        number;
  ewalletCode:   string;      // e.g. 'dana_ewallet', 'ovo_ewallet', etc.
  email?:        string;
  redirectUrl:   string;
  expiration?:   number;      // in minutes
}

export class EwalletService {
  // Use staging for development, prod for production
  private base = `${config.api.oy.baseUrl}${config.api.oy.endpoints.ewallet}`;
  private key     = config.api.oy.apiKey;
  private user    = config.api.oy.username;

  /**
   * Create a generic e-wallet transaction via OY!
   */
  async createEwalletTransaction(params: CreateEwalletParams) {
    const url = `${this.base}/create-transaction`;
    const headers = {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'X-Api-Key':     this.key,
      'X-Oy-Username': this.user
    };
    const body = {
      customer_id:          params.buyerId,
      partner_trx_id:       params.partnerTrxId,
      amount:               params.amount,
      email:                params.email,
      ewallet_code:         params.ewalletCode,
      success_redirect_url: params.redirectUrl,
      expiration_time:      params.expiration ?? 15
    };

    const resp = await axios.post(url, body, { headers });
    const data = resp.data;
    if (data.status?.code !== '000') {
      throw new Error(`OY CreateTxn failed: ${data.status?.message}`);
    }

    // Persist to transaction_request with generic fields
    await prisma.transaction_request.create({
      data: {
        merchantId:      params.merchantId,
        subMerchantId:   params.subMerchantId,
        buyerId:         params.buyerId,
        amount:          params.amount,
        status:          data.ewallet_trx_status,
        paymentProvider: `OY_${params.ewalletCode.toUpperCase()}`,
        gatewayCustom:   data.partner_trx_id,
        trxId:           data.trx_id,
        ewalletUrl:      data.ewallet_url,
        expiration:      params.expiration ?? 15
      }
    });

    return data;
  }

  /**
   * Check status for any e-wallet transaction
   */
  async checkStatus(partnerTrxId: string) {
    const url = `${this.base}/check-status`;
    const headers = {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'X-Api-Key':     this.key,
      'X-Oy-Username': this.user
    };
    const resp = await axios.post(url, { partner_trx_id: partnerTrxId }, { headers });
    const data = resp.data;
    if (data.status?.code !== '000') {
      throw new Error(`OY CheckStatus failed: ${data.status?.message}`);
    }

    // Update status on DB
    await prisma.transaction_request.updateMany({
      where: { gatewayCustom: partnerTrxId },
      data: { status: data.ewallet_trx_status }
    });

    return data;
  }
}