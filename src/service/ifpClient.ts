import axios from 'axios';
import crypto from 'crypto';
import { signRsa } from '../util/ifpSign';
import { isoTimestamp } from '../util/ifpTime';

export interface QrCustomer {
  name: string;
  phone?: string;
  email?: string;
  id?: string;
}

export interface QrPaymentRequest {
  amount: number;
  customer?: QrCustomer;
  external_id?: string;
  order_id?: string;
  customer_details?: Record<string, any>;
  wallet_details?: Record<string, any>;
  callback_url?: string;
  [key: string]: any;
}

export interface QrPaymentResponse {
  qr_string: string;
  qr_url: string;
}

// Konfigurasi yang disimpan di database untuk IFP
export interface IfpConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export class IfpClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;

  constructor(opts: Partial<IfpConfig> = {}) {
    this.baseUrl = opts.baseUrl || process.env.IFP_BASE_URL || process.env.SENMO_DNS || '';
    this.clientId = opts.clientId || process.env.IFP_CLIENT_ID || '';
    this.clientSecret = opts.clientSecret || process.env.IFP_CLIENT_SECRET || '';
  }

  private async getToken(): Promise<string> {
    const ts  = isoTimestamp();
    const sig = signRsa(`${this.clientId}|${ts}`);
    const { data } = await axios.post(
      `${this.baseUrl}/api/v1.0/access-token/b2b`,
      { grantType: 'client_credentials' },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-TIMESTAMP': ts,
          'X-CLIENT-KEY': this.clientId,
          'X-SIGNATURE': sig,
        },
      }
    );
    return data.accessToken as string;
  }

  async createQrPayment(req: QrPaymentRequest): Promise<QrPaymentResponse> {
    const token = await this.getToken();
    const ts = isoTimestamp();

    let body: any;
    let extId = req.external_id || Date.now().toString();

    if (req.external_id) {
      body = {
        external_id: req.external_id,
        order_id: req.order_id || req.external_id,
        amount: req.amount,
        customer_details: req.customer_details || {},
        wallet_details: req.wallet_details || {},
        callback_url: req.callback_url,
      };
    } else {
      body = {
        partnerReferenceNo: req.customer?.id || extId,
        amount: { value: Number(req.amount).toFixed(2), currency: 'IDR' },
        additionalInfo: {
          customerName: req.customer?.name,
          customerPhone: req.customer?.phone,
          customerEmail: req.customer?.email,
        },
      };
    }

    const payloadHex = crypto
      .createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex')
      .toLowerCase();

    const endpoint = '/api/v1.0/qr-payment';
    const stringToSign = `POST:${endpoint}:${token}:${payloadHex}:${ts}`;
    const signature = crypto
      .createHmac('sha512', this.clientSecret)
      .update(stringToSign)
      .digest('base64');

    const { data } = await axios.post(`${this.baseUrl}${endpoint}`, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-PARTNER-ID': this.clientId,
        'X-EXTERNAL-ID': extId,
        'X-TIMESTAMP': ts,
        'X-SIGNATURE': signature,
        'CHANNEL-ID': 'api',
      },
    });

    return {
      qr_string: data.qrString ?? data.qr_string,
      qr_url: data.qrUrl ?? data.qr_url ?? data.checkout_url,
    };
  }
}

export default IfpClient;

