import axios, { AxiosInstance } from 'axios';

export interface IfpConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export class IfpClient {
  private client: AxiosInstance;

  constructor(private config: IfpConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-CLIENT-KEY': config.clientId,
        'X-CLIENT-SECRET': config.clientSecret,
      },
    });
  }

  async createQrPayment(payload: any): Promise<any> {
    const path = '/api/v1/qr-payment';
    const res = await this.client.post(path, payload);
    return res.data;
  }
}

export default IfpClient;
