// File: src/core/hilogateClient.ts
import axios, {
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import crypto from 'crypto';

// Konfigurasi yang kita simpan di DB
export interface HilogateConfig {
  merchantId: string;
  env: 'sandbox' | 'live' | 'production'; // tambahkan "production"
  secretKey: string;
}

export class HilogateClient {
  private axiosInst: AxiosInstance;
  private secretKey: string;

  constructor(private config: HilogateConfig) {
    this.secretKey = config.secretKey;
    this.axiosInst = axios.create({
      baseURL:
        config.env === 'live'
          ? 'https://app.hilogate.com'
          : 'https://sandbox.hilogate.com',
      headers: {
        'Content-Type': 'application/json',
        'X-Merchant-ID': config.merchantId,
        'X-Environment': config.env,
      },
    });

    // Interceptor untuk logging request
    this.axiosInst.interceptors.request.use((req: InternalAxiosRequestConfig) => {
      console.log('─── HILOGATE REQUEST ───');
      console.log(req.method?.toUpperCase(), this.axiosInst.defaults.baseURL + req.url);
      console.log('Headers:', JSON.stringify(req.headers, null, 2));
      if (req.data) console.log('Body:', JSON.stringify(req.data, null, 2));
      return req;
    });

    // Interceptor untuk logging response / error
    this.axiosInst.interceptors.response.use(
      (res: AxiosResponse) => {
        console.log('─── HILOGATE RESPONSE ───');
        console.log('Status:', res.status);
        console.log('Data:', JSON.stringify(res.data, null, 2));
        return res;
      },
      err => {
        if (err.response) {
          console.log('─── HILOGATE ERROR RESPONSE ───');
          console.log('Status:', err.response.status);
          console.log('Data:', JSON.stringify(err.response.data, null, 2));
        } else {
          console.log('─── HILOGATE ERROR ───', err.message);
        }
        return Promise.reject(err);
      }
    );
  }

  /** Generate MD5 signature */
  private sign(path: string, body: any = null): string {
    const payload = body
      ? `${path}${JSON.stringify(body)}${this.secretKey}`
      : `${path}${this.secretKey}`;
    return crypto.createHash('md5').update(payload).digest('hex');
  }

  /** GET FULL response for Balance (but with our headers) */
  public async getBalance(): Promise<any> {
    const path = '/api/v1/balance';
    const signature = this.sign(path, null);
    const headers = {
      'X-Merchant-ID': this.config.merchantId,
      'X-Signature': signature,
      'X-Merchant-Key': this.secretKey, // khusus endpoint ini

    };
    const res = await this.axiosInst.get(path, { headers });
    return res.data; // seluruh payload JSON
  }

  /** GET bank codes */
  public async getBankCodes(): Promise<{ name: string; code: string }[]> {
    const path = '/api/v1/references/bank-codes';
    const signature = this.sign(path, null);
    const res = await this.axiosInst.get<{
      code: number;
      data: { name: string; code: string }[];
    }>(path, {
      headers: {
        'X-Signature': signature,
        'X-Merchant-Key': this.secretKey, // khusus endpoint ini
      },
    });
    return res.data.data;
  }

  /** Validate bank account */
  public async validateAccount(account_number: string, bank_code: string): Promise<any> {
    const path = '/api/v1/bank-accounts/validate';
    const body = { account_number, bank_code };
    const signature = this.sign(path, body);
    return this.request('post', path, body);
  }

  /** Buat transaksi QRIS */
  public async createTransaction(opts: {
    ref_id: string;
    amount: number;
    method?: string;
  }): Promise<any> {
    return this.requestFull('post', '/api/v1/transactions', {
      ref_id: opts.ref_id,
      amount: opts.amount,
      method: opts.method || 'qris',
    });
  }

  /** Ambil status transaksi */
  public async getTransaction(ref_id: string): Promise<any> {
    return this.requestFull('get', `/api/v1/transactions/${ref_id}`);
  }

  /** Buat withdrawal */
  public async createWithdrawal(payload: {
    ref_id: string;
    amount: number;
    currency: string;
    account_number: string;
    account_name: string;
    account_name_alias: string;
    bank_code: string;
    bank_name: string;
    branch_name: string;
    description: string;
  }): Promise<any> {
    return this.request('post', '/api/v1/withdrawals', payload);
  }

  /** Helper untuk POST/PATCH yang hanya mengembalikan data.data */
  private async request(
    method: 'get' | 'post' | 'patch',
    path: string,
    body: any = null
  ): Promise<any> {
    const signature = this.sign(path, body);
    const headers: any = { 'X-Signature': signature };
    if (method === 'get') {
      const res = await this.axiosInst.get(path, { headers });
      return res.data;
    } else {
      const res = await this.axiosInst.request({
        method,
        url: path,
        headers,
        data: body,
      });
      return res.data.data;
    }
  }

  /** Helper yang mengembalikan seluruh res.data */
  private async requestFull(
    method: 'get' | 'post' | 'patch',
    path: string,
    body: any = null
  ): Promise<any> {
    const signature = this.sign(path, body);
    const headers: any = {
      'X-Signature': signature,
      'X-Merchant-Key': this.secretKey,
    };
    if (method === 'get') {
      const res = await this.axiosInst.get(path, { headers });
      return res.data;
    } else {
      const res = await this.axiosInst.request({
        method,
        url: path,
        headers,
        data: body,
      });
      return res.data;
    }
  }
}
