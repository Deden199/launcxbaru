// File: src/core/hilogateClient.ts
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';

const BASE = config.api.hilogate.baseUrl;  // e.g. https://app.hilogate.com

class HilogateClient {
  private axiosInst = axios.create({
    baseURL: BASE,
    headers: {
      'Content-Type':  'application/json',
      'X-Merchant-ID': config.api.hilogate.merchantId,
      'X-Environment': config.api.hilogate.env,
    },
  });
  private secretKey = config.api.hilogate.secretKey;

  /** Hitung MD5 signature sesuai docs v1.4 */
  private sign(path: string, body: any = null): string {
    const payload = body
      ? `${path}${JSON.stringify(body)}${this.secretKey}`
      : `${path}${this.secretKey}`;
    return crypto.createHash('md5').update(payload).digest('hex');
  }

  

  /** Validasi signature callback Hilogate: MD5(request_body + secretKey) */
  public verifyCallback(rawBody: string, signature: string): boolean {
    const expected = crypto
      .createHash('md5')
      .update(rawBody + this.secretKey)
      .digest('hex');
    return expected === signature;
  }
  public async getBalance() {
    // note: request tetap private
    return this.requestFull('get', '/api/v1/balance')
  }

    public async getBankCodes(): Promise<{ name: string; code: string }[]> {
    const path = '/api/v1/references/bank-codes'
    const signature = this.sign(path, null)

    const resp = await this.axiosInst.get<{
      code: number
      data: { name: string; code: string }[]
    }>(path, {
      headers: {
        'X-Signature': signature,
        'X-Merchant-Key': this.secretKey,    // wajib di endpoint ini
      },
    })

    return resp.data.data
  }
  public async validateAccount(account_number: string, bank_code: string): Promise<any> {
  const path = '/api/v1/bank-accounts/validate'
  const body = { account_number, bank_code }
  const signature = this.sign(path, body)
  console.log('[HILOGATE VALIDATE]', {
    url:    this.axiosInst.defaults.baseURL + path,
    env:    this.axiosInst.defaults.headers['X-Environment'],
    mid:    this.axiosInst.defaults.headers['X-Merchant-ID'],
    sig:    signature,
    body,
  })
  return this.request('post', path, body);
}


  /** Internal request helper */
private async request(
  method: 'get' | 'post' | 'patch',
  path: string,
  body: any = null
): Promise<any> {
  const signature = this.sign(path, body);
  const headers = { 'X-Signature': signature };

  if (method === 'get') {
    // GET tanpa body
    const res = await this.axiosInst.get(path, { headers });
    return res.data;
  } else {
    // POST/PATCH dengan body
    const res = await this.axiosInst.request({
      method,
      url: path,
      headers,
      data: body
    });
    return res.data.data;
  }
}

private async requestFull(
    method: 'get' | 'post' | 'patch',
    path: string,
    body: any = null
  ): Promise<any> {
    const signature = this.sign(path, body);
    const headers = { 'X-Signature': signature };

    if (method === 'get') {
      const res = await this.axiosInst.get(path, { headers });
      return res.data;
    } else {
      const res = await this.axiosInst.request({
        method,
        url: path,
        headers,
        data: body
      });
      // 🔥 Bypass dan kembalikan seluruh body (status + data)
      return res.data;
    }
  }


  /** Buat transaksi QRIS */
  public async createTransaction(opts: {
    ref_id: string;
    amount: number;
    method?: string;
  }): Promise<any> {
    return this.requestFull(
      'post',
      '/api/v1/transactions',
      { ref_id: opts.ref_id, amount: opts.amount, method: opts.method || 'qris' }
    );
  }

  /** Ambil status transaksi dari Hilogate */
  public async getTransaction(ref_id: string): Promise<any> {
    return this.requestFull('get', `/api/v1/transactions/${ref_id}`);
  }

public async createWithdrawal(payload: {
  ref_id:             string;
  amount:             number;
  currency:           string;
  account_number:     string;
  account_name:       string;
  account_name_alias: string;
  bank_code:          string;
  bank_name:          string;
  branch_name:        string;
  description:        string;
}): Promise<any> {
  return this.request('post', '/api/v1/withdrawals', payload);
}
}

export default new HilogateClient();