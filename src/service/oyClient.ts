// File: src/service/oyClient.ts
import axios, { AxiosInstance } from 'axios';
import logger from '../logger';

export interface OyConfig {
  baseUrl: string;
  username: string;
  apiKey: string;
}

export class OyClient {
  private client: AxiosInstance;

  constructor(private config: OyConfig) {
    const isProd = config.baseUrl === 'production';
    this.client = axios.create({
      baseURL: 'https://partner.oyindonesia.com',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Oy-Username': config.username,
        'X-Api-Key': config.apiKey,
      },
    });
  }

  // Disbursement APIs
  async disburse(data: any): Promise<any> {
    const res = await this.client.post('/api/remit', data);
    return res.data;
  }

  async checkDisbursementStatus(
    partnerTrxId: string,
    sendCallback = false
  ): Promise<any> {
    const res = await this.client.post('/api/remit-status', {
      partner_trx_id: partnerTrxId,
      send_callback: sendCallback,
    });
    return res.data;
  }

  // Balance API
  async getBalance(): Promise<any> {
    const res = await this.client.get('/api/balance');
    return res.data;
  }

  // E-Wallet Aggregator API
  async createEwallet(data: any): Promise<any> {
    const res = await this.client.post(
      '/api/e-wallet-aggregator/create-transaction',
      data
    );
    return res.data;
  }

  async checkEwalletStatus(partnerTrxId: string): Promise<any> {
    const res = await this.client.post('/api/e-wallet-aggregator/check-status', {
      partner_trx_id: partnerTrxId,
    });
    return res.data;
  }

  // QRIS API
  async createQRISTransaction(data: any): Promise<any> {
    const path = '/api/payment-routing/create-transaction';
    const body = {
      ...data,
      list_enable_payment_method: 'QRIS',
      list_enable_sof: 'QRIS',
      need_frontend: false,
    };
    logger.info('[OY QRIS] ▶ Request', { path, body });
    const res = await this.client.post(path, body);
    logger.info('[OY QRIS] ◀ Response', { data: res.data });
    return res.data;
  }

  async checkQRISTransactionStatus(
    partnerTrxId: string,
    sendCallback = false
  ): Promise<any> {
    const res = await this.client.post('/api/payment-routing/check-status', {
      partner_trx_id: partnerTrxId,
      send_callback: sendCallback,
    });
    return res.data;
  }
}
