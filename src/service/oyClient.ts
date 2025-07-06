import axios, {
  AxiosInstance,
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig
} from 'axios';
import logger from '../logger';

interface OyConfig {
  baseUrl: string;    // ← ganti baseURL jadi baseUrl
  username: string;
  apiKey: string;
}

// Disbursement
interface DisbursementRequest {
  recipient_bank: string;
  recipient_account: string;
  amount: number;
  note?: string;
  partner_trx_id: string;
  email?: string;
  child_balance?: string;
  additional_data?: Record<string, any>;
}
interface DisbursementResponse {
  status: { code: string; message: string };
  amount: number;
  recipient_bank: string;
  recipient_account: string;
  trx_id: string;
  partner_trx_id: string;
  timestamp: string;
}

// E-Wallet Aggregator
interface EWalletTransactionRequest {
  customer_id: string;
  partner_trx_id: string;
  sub_merchant_id?: string;
  amount: number;
  email?: string;
  ewallet_code: string;
  mobile_number?: string;
  success_redirect_url?: string;
  expiration_time?: number;
}
interface EWalletTransactionResponse {
  status: { code: string; message: string };
  ewallet_trx_status: string;
  amount: number;
  trx_id: string;
  partner_trx_id: string;
  ewallet_code: string;
  ewallet_url: string;
  ref_number?: string;
}

// QRIS / Payment Routing
interface PaymentRoutingRequest {
  partner_user_id?: string;
  partner_trx_id: string;
  need_frontend: boolean;
  receive_amount: number;
  list_enable_payment_method: string;
  list_enable_sof: string;
  trx_expiration_time?: string;
  use_linked_account?: boolean;
  sender_email?: string;
}
interface PaymentRoutingResponse {
  status: { code: string; message: string };
  trx_id: string;
  partner_trx_id: string;
  receive_amount: number;
  trx_expiration_time?: string;
  payment_method: string;
  sender_bank?: string;
  payment_info?: { qris_url?: string };
}

export default class OyClient {
  private client: AxiosInstance;
  constructor(config: OyConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'X-Oy-Username': config.username,
        'X-Api-Key':     config.apiKey,
      },
    });

    // Request interceptor
    this.client.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
      logger.info('[OY] ▶ Request:', {
        method: cfg.method?.toUpperCase(),
        url:    `${cfg.baseURL}${cfg.url}`,
        headers: cfg.headers,
        data:    cfg.data,
      });
      return cfg;
    });

    // Response interceptor
    this.client.interceptors.response.use(
      (res: AxiosResponse) => {
        logger.info('[OY] ◀ Response:', {
          status:  res.status,
          url:     res.config.url,
          data:    res.data,
        });
        return res;
      },
      (err: AxiosError) => {
        if (err.config) {
          logger.error('[OY] ✖ Error for Request:', {
            method: err.config.method?.toUpperCase(),
            url:    `${err.config.baseURL}${err.config.url}`,
            data:   err.config.data,
          });
        }
        if (err.response) {
          logger.error('[OY] ◀ Error Response:', {
            status:  err.response.status,
            headers: err.response.headers,
            data:    err.response.data,
          });
        } else {
          logger.error('[OY] Network/Error:', err.message);
        }
        return Promise.reject(err);
      }
    );
  }

  // Disbursement APIs
  async disburse(data: DisbursementRequest): Promise<DisbursementResponse> {
    const res = await this.client.post<DisbursementResponse>('/api/remit', data);
    return res.data;
  }
  async checkDisbursementStatus(partnerTrxId: string, sendCallback = false) {
    const res = await this.client.post<DisbursementResponse>('/api/remit-status', {
      partner_trx_id: partnerTrxId,
      send_callback: sendCallback,
    });
    return res.data;
  }

  // Balance API
  async getBalance() {
    const res = await this.client.get('/api/balance');
    return res.data;
  }

  // E-Wallet Aggregator APIs
  async createEWalletTransaction(
    data: EWalletTransactionRequest
  ): Promise<EWalletTransactionResponse> {
    const res = await this.client.post<EWalletTransactionResponse>(
      '/api/e-wallet-aggregator/create-transaction',
      data
    );
    return res.data;
  }
  async checkEWalletStatus(
    partnerTrxId: string
  ): Promise<EWalletTransactionResponse> {
    const res = await this.client.post<EWalletTransactionResponse>(
      '/api/e-wallet-aggregator/check-status',
      { partner_trx_id: partnerTrxId }
    );
    return res.data;
  }
  async refundEWalletTransaction(partnerTrxId: string, refundAmount: number) {
    const res = await this.client.post('/api/e-wallet-aggregator/refund', {
      partner_trx_id: partnerTrxId,
      refund_amount: refundAmount,
    });
    return res.data;
  }
  async getEWalletRefundStatus(refundId: string) {
    const res = await this.client.get('/api/e-wallet-aggregator/get-refund', {
      params: { refund_id: refundId },
    });
    return res.data;
  }
  async listEWalletRefunds(partnerTrxId: string) {
    const res = await this.client.get('/api/e-wallet-aggregator/list-refund', {
      params: { partner_trx_id: partnerTrxId },
    });
    return res.data;
  }

   async createQRISTransaction(
    data: Omit<PaymentRoutingRequest, 'list_enable_payment_method' | 'list_enable_sof'>
  ): Promise<PaymentRoutingResponse> {
    const path = '/api/payment-routing/create-transaction';

    // Bangun body lengkap
    const body: PaymentRoutingRequest = {
      ...data,
      list_enable_payment_method: 'QRIS',
      list_enable_sof:            'QRIS',
      need_frontend:              false,
    };

    // ————— Log sebelum request —————
    logger.info('[OY QRIS] ▶ Request', {
      method:  'POST',
      url:     `${this.client.defaults.baseURL}${path}`,
      headers: this.client.defaults.headers,  // ini akan memuat X-Oy-Username & X-Api-Key
      body,
    });

    let res: AxiosResponse<PaymentRoutingResponse>;
    try {
      res = await this.client.post<PaymentRoutingResponse>(path, body);
    } catch (err: any) {
      // ————— Log error detail —————
      logger.error('[OY QRIS] ✖ ERROR POST', {
        status:   err.response?.status,
        url:      err.config?.url,
        reqBody:  body,
        respData: err.response?.data,
      });
      throw err;
    }

    // ————— Log setelah response —————
    logger.info('[OY QRIS] ◀ Response', {
      status: res.status,
      data:   res.data,
    });

    return res.data;
  }


  async checkQRISTransactionStatus(
    partnerTrxId: string,
    sendCallback = false
  ): Promise<PaymentRoutingResponse> {
    const res = await this.client.post<PaymentRoutingResponse>(
      '/api/payment-routing/check-status',
      {
        partner_trx_id: partnerTrxId,
        send_callback: sendCallback,
      }
    );
    return res.data;
  }
}
