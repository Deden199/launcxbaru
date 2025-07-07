// File: src/service/oyClient.ts
import axios, { AxiosInstance, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import logger from '../logger';
import { config } from '../config';

export interface OyConfig {
    baseUrl: string     // ← tambahkan ini

  username: string;
  apiKey:   string;
}

export class OyClient {
  private client: AxiosInstance;

  constructor(private config: OyConfig) {
    // Tentukan apakah production atau sandbox
    const isProd = config.baseUrl === 'production' || config.baseUrl === 'production';

    this.client = axios.create({
      baseURL: isProd
        ? 'https://partner.oyindonesia.com'
        : 'https://partner.oyindonesia.com',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        'X-Oy-Username': config.username,
        'X-Api-Key':     config.apiKey,
      },
    });

    // (opsional) interceptor untuk log
    this.client.interceptors.request.use(req => {
      console.log(`→ OY REQUEST [${req.method}] ${req.baseURL}${req.url}`);
      console.log('Headers:', req.headers);
      if (req.data) console.log('Body:', req.data);
      return req;
    });
    this.client.interceptors.response.use(
      res => (console.log('← OY RESPONSE', res.status, res.data), res),
      err => {
        if (err.response) {
          console.log('← OY ERROR', err.response.status, err.response.data);
        } else {
          console.log('← OY ERROR', err.message);
        }
        return Promise.reject(err);
      }
    );
  }

  // Disbursement APIs
  async disburse(data: any): Promise<any> {
    const res = await this.client.post('/api/remit', data);
    return res.data;
  }

  async checkDisbursementStatus(partnerTrxId: string, sendCallback = false): Promise<any> {
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
    const res = await this.client.post('/api/e-wallet-aggregator/create-transaction', data);
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
      list_enable_sof:            'QRIS',
      need_frontend:              false,
    };
    logger.info('[OY QRIS] ▶ Request', { path, body });
    const res = await this.client.post(path, body);
    logger.info('[OY QRIS] ◀ Response', { data: res.data });
    return res.data;
  }

  async checkQRISTransactionStatus(partnerTrxId: string, sendCallback = false): Promise<any> {
    const res = await this.client.post('/api/payment-routing/check-status', {
      partner_trx_id: partnerTrxId,
      send_callback: sendCallback,
    });
    return res.data;
  }
}


