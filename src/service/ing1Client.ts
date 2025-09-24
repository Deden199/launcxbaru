import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export type Ing1TransactionStatus = 'PAID' | 'PENDING' | 'FAILED';

export interface Ing1Config {
  baseUrl: string;
  email: string;
  password: string;
  /**
   * Default product_code used when creating cash-in transactions.
   * Example: `QRIS_DIRECT`.
   */
  productCode?: string;
  /** Optional callback/return URL passed to Billers. */
  callbackUrl?: string;
  /** Optional permanent token that can be reused without logging in. */
  permanentToken?: string;
  /** Optional Billers merchant identifier. */
  merchantId?: string;
  /** Optional API version segment (e.g. `v2`). */
  apiVersion?: string;
}

export interface Ing1CashinParams {
  amount: number;
  clientReff: string;
  productCode?: string;
  remark?: string;
  expiryTime?: string;
  returnUrl?: string;
  merchantId?: string;
}

export interface Ing1CashinResult {
  rc: number;
  message: string;
  status: Ing1TransactionStatus;
  reff?: string | null;
  clientReff?: string | null;
  productCode?: string | null;
  paymentUrl?: string | null;
  qrContent?: string | null;
  expiredAt?: string | null;
  data: any;
  raw: any;
}

export interface Ing1CheckParams {
  reff: string;
  clientReff?: string;
}

export interface Ing1CheckResult {
  rc: number;
  message: string;
  status: Ing1TransactionStatus;
  reff?: string | null;
  clientReff?: string | null;
  productCode?: string | null;
  data: any;
  raw: any;
}

export interface Ing1HistoryQuery {
  page?: number;
  perPage?: number;
  startDate?: string;
  endDate?: string;
  clientReff?: string;
  reff?: string;
}

export interface Ing1HistoryItem {
  amount: number;
  paymentUrl: string | null;
  content: string | null;
  returnUrl: string | null;
  status: string;
  normalizedStatus: Ing1TransactionStatus;
  rrn?: string | null;
  reff?: string | null;
  clientReff?: string | null;
  remark?: string | null;
  paidAt?: string | null;
  expiredAt?: string | null;
  createdAt?: string | null;
  name?: string | null;
  raw: any;
}

export interface Ing1HistoryResult {
  rc: number;
  message: string;
  status: Ing1TransactionStatus;
  histories: Ing1HistoryItem[];
  pagination: {
    currentPage?: number;
    perPage?: number;
    total?: number;
    lastPage?: number;
    from?: number;
    to?: number;
    hasNextPage?: boolean;
    nextPageUrl?: string | null;
    prevPageUrl?: string | null;
  };
  raw: any;
}

export interface Ing1CashoutInquiryParams {
  bankCode: string;
  accountNumber: string;
  amount: number;
  clientReff: string;
  customerName?: string;
  remark?: string;
  merchantId?: string;
}

export interface Ing1CashoutInquiryResult {
  rc: number;
  message: string;
  status: Ing1TransactionStatus;
  reff?: string | null;
  clientReff?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  amount?: number | null;
  fee?: number | null;
  data: any;
  raw: any;
}

export interface Ing1CashoutPaymentParams {
  reff: string;
  clientReff?: string;
  amount?: number;
  otp?: string;
  remark?: string;
  merchantId?: string;
}

export interface Ing1CashoutPaymentResult {
  rc: number;
  message: string;
  status: Ing1TransactionStatus;
  reff?: string | null;
  clientReff?: string | null;
  data: any;
  raw: any;
}

export interface Ing1CashoutCheckParams {
  reff: string;
  clientReff?: string;
}

export interface Ing1CashoutCheckResult {
  rc: number;
  message: string;
  status: Ing1TransactionStatus;
  reff?: string | null;
  clientReff?: string | null;
  data: any;
  raw: any;
}

export interface Ing1CashoutHistoryQuery {
  page?: number;
  perPage?: number;
  startDate?: string;
  endDate?: string;
  clientReff?: string;
  reff?: string;
  status?: string;
  custno?: string;
}

export interface Ing1CashoutHistoryItem {
  amount: number | null;
  fee: number | null;
  status: string;
  normalizedStatus: Ing1TransactionStatus;
  reff?: string | null;
  clientReff?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  remark?: string | null;
  raw: any;
}

export interface Ing1CashoutHistoryResult {
  rc: number;
  message: string;
  status: Ing1TransactionStatus;
  histories: Ing1CashoutHistoryItem[];
  pagination: {
    currentPage?: number;
    perPage?: number;
    total?: number;
    lastPage?: number;
    from?: number;
    to?: number;
    hasNextPage?: boolean;
    nextPageUrl?: string | null;
    prevPageUrl?: string | null;
  };
  raw: any;
}

const mapRcToStatus = (rc: number): Ing1TransactionStatus => {
  switch (rc) {
    case 0:
      return 'PAID';
    case 91:
      return 'PENDING';
    case 99:
    default:
      return 'FAILED';
  }
};

const normalizeHistoryStatus = (status: string | undefined | null): Ing1TransactionStatus => {
  if (!status) return 'FAILED';
  const lowered = status.toLowerCase();
  if (lowered === 'success' || lowered === 'paid') return 'PAID';
  if (lowered === 'pending' || lowered === 'process') return 'PENDING';
  return 'FAILED';
};

const parseNumeric = (value: unknown): number | null => {
  if (value == null) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export class Ing1Client {
  private readonly http: AxiosInstance;
  private token: string | null;
  private tokenExpiry: number | null;
  private inflightLogin: Promise<string> | null = null;

  constructor(private readonly cfg: Ing1Config) {
    const trimmedBase = cfg.baseUrl.replace(/\/$/, '');
    const version = cfg.apiVersion ? cfg.apiVersion.replace(/^\//, '') : '';
    const baseURL = version ? `${trimmedBase}/${version}` : trimmedBase;

    this.http = axios.create({
      baseURL,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    this.token = cfg.permanentToken ?? null;
    this.tokenExpiry = this.token ? this.extractExpiry(this.token) : null;
  }

  private extractExpiry(token: string): number | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      if (!payload || typeof payload.exp !== 'number') return null;
      return payload.exp * 1000;
    } catch (err) {
      return null;
    }
  }

  private isTokenValid(): boolean {
    if (!this.token) return false;
    if (!this.tokenExpiry) return true;
    return Date.now() < this.tokenExpiry - 60 * 1000;
  }

  private async ensureToken(force = false): Promise<string> {
    if (!force && this.isTokenValid()) {
      return this.token!;
    }

    if (this.inflightLogin) {
      return this.inflightLogin;
    }

    this.inflightLogin = this.login()
      .then((token) => {
        this.token = token;
        this.tokenExpiry = this.extractExpiry(token);
        return token;
      })
      .finally(() => {
        this.inflightLogin = null;
      });

    return this.inflightLogin;
  }

  private async login(): Promise<string> {
    if (!this.cfg.email || !this.cfg.password) {
      throw new Error('Missing ING1 credentials (email/password)');
    }

    const { data } = await this.http.post('user/login', {
      email: this.cfg.email,
      password: this.cfg.password,
    });

    const token = data?.data?.token ?? data?.token;
    if (!token || typeof token !== 'string') {
      throw new Error('Failed to login to ING1: token missing');
    }
    return token;
  }

  private async authorizedRequest<T = any>(
    config: AxiosRequestConfig,
    allowRetry = true
  ): Promise<T> {
    const token = await this.ensureToken();
    const headers = {
      ...(config.headers ?? {}),
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await this.http.request<T>({ ...config, headers });
      const payload: any = response.data;
      const rc = typeof payload?.rc === 'number' ? payload.rc : Number(payload?.rc ?? NaN);
      if (allowRetry && rc === 98) {
        await this.ensureToken(true);
        return this.authorizedRequest<T>(config, false);
      }
      return response.data;
    } catch (err) {
      if (allowRetry && axios.isAxiosError(err)) {
        const status = err.response?.status ?? 0;
        if (status === 401 || status === 403) {
          await this.ensureToken(true);
          return this.authorizedRequest<T>(config, false);
        }
      }
      throw err;
    }
  }

  async createCashin(params: Ing1CashinParams): Promise<Ing1CashinResult> {
    const productCode = params.productCode ?? this.cfg.productCode;
    if (!productCode) {
      throw new Error('ING1 product_code is required');
    }

    const payload: Record<string, any> = {
      product_code: productCode,
      amount: params.amount,
      client_reff: params.clientReff,
    };

    if (params.remark) payload.remark = params.remark;
    if (params.expiryTime) payload.expiry_time = params.expiryTime;

    const returnUrl = params.returnUrl ?? this.cfg.callbackUrl;
    if (returnUrl) payload.return_url = returnUrl;

    const merchantId = params.merchantId ?? this.cfg.merchantId;
    if (merchantId) payload.merchant_id = merchantId;

    const data = await this.authorizedRequest<any>({
      method: 'POST',
      url: 'transaction/cashin/create',
      data: payload,
    });

    const rc = typeof data?.rc === 'number' ? data.rc : Number(data?.rc ?? 99);
    const result: Ing1CashinResult = {
      rc,
      message: data?.message ?? '',
      status: mapRcToStatus(rc),
      reff: data?.reff ?? null,
      clientReff: data?.client_reff ?? null,
      productCode: data?.product_code ?? productCode,
      paymentUrl: data?.data?.payment_url ?? null,
      qrContent: data?.data?.content ?? null,
      expiredAt: data?.data?.expired_at ?? null,
      data: data?.data,
      raw: data,
    };
    return result;
  }

  async checkCashin(params: Ing1CheckParams): Promise<Ing1CheckResult> {
    const payload: Record<string, any> = { reff: params.reff };
    if (params.clientReff) payload.client_reff = params.clientReff;

    const data = await this.authorizedRequest<any>({
      method: 'POST',
      url: 'transaction/cashin/check',
      data: payload,
    });

    const rc = typeof data?.rc === 'number' ? data.rc : Number(data?.rc ?? 99);
    return {
      rc,
      message: data?.message ?? '',
      status: mapRcToStatus(rc),
      reff: data?.reff ?? payload.reff,
      clientReff: data?.client_reff ?? payload.client_reff ?? null,
      productCode: data?.product_code ?? null,
      data: data?.data,
      raw: data,
    };
  }

  async listCashinHistory(query: Ing1HistoryQuery = {}): Promise<Ing1HistoryResult> {
    const params: Record<string, any> = {};
    if (query.page != null) params.page = query.page;
    if (query.perPage != null) params.per_page = query.perPage;
    if (query.startDate) params.start_date = query.startDate;
    if (query.endDate) params.end_date = query.endDate;
    if (query.clientReff) params.client_reff = query.clientReff;
    if (query.reff) params.reff = query.reff;

    const data = await this.authorizedRequest<any>({
      method: 'GET',
      url: 'transaction/cashin/history',
      params,
    });

    const rc = typeof data?.rc === 'number' ? data.rc : Number(data?.rc ?? 99);
    const historiesRaw: any[] = Array.isArray(data?.histories) ? data.histories : [];

    const histories: Ing1HistoryItem[] = historiesRaw.map((item) => ({
      amount: Number(item?.amount ?? 0),
      paymentUrl: item?.payment_url ?? null,
      content: item?.content ?? null,
      returnUrl: item?.return_url ?? null,
      status: item?.status ?? '',
      normalizedStatus: normalizeHistoryStatus(item?.status),
      rrn: item?.rrn ?? null,
      reff: item?.reff ?? null,
      clientReff: item?.client_reff ?? null,
      remark: item?.remark ?? null,
      paidAt: item?.paid_at ?? null,
      expiredAt: item?.expired_at ?? null,
      createdAt: item?.created_at ?? null,
      name: item?.name ?? null,
      raw: item,
    }));

    const pagination = {
      currentPage: data?.current_page,
      perPage: data?.per_page,
      total: data?.total,
      lastPage: data?.last_page,
      from: data?.from,
      to: data?.to,
      hasNextPage: data?.has_next_page,
      nextPageUrl: data?.next_page_url ?? null,
      prevPageUrl: data?.prev_page_url ?? null,
    };

    return {
      rc,
      message: data?.message ?? '',
      status: mapRcToStatus(rc),
      histories,
      pagination,
      raw: data,
    };
  }

  async cashoutInquiry(params: Ing1CashoutInquiryParams): Promise<Ing1CashoutInquiryResult> {
    const payload: Record<string, any> = {
      bank_code: params.bankCode,
      account_no: params.accountNumber,
      amount: params.amount,
      client_reff: params.clientReff,
    };

    if (params.customerName) payload.customer_name = params.customerName;
    if (params.remark) payload.remark = params.remark;

    const merchantId = params.merchantId ?? this.cfg.merchantId;
    if (merchantId) payload.merchant_id = merchantId;

    const data = await this.authorizedRequest<any>({
      method: 'POST',
      url: 'transaction/cashout/inquiry',
      data: payload,
    });

    const rc = typeof data?.rc === 'number' ? data.rc : Number(data?.rc ?? 99);
    const details = data?.data ?? {};

    const result: Ing1CashoutInquiryResult = {
      rc,
      message: data?.message ?? '',
      status: mapRcToStatus(rc),
      reff: data?.reff ?? details?.reff ?? null,
      clientReff: data?.client_reff ?? details?.client_reff ?? payload.client_reff ?? null,
      bankCode: details?.bank_code ?? details?.bankCode ?? payload.bank_code ?? null,
      bankName: details?.bank_name ?? details?.bankName ?? null,
      accountNumber:
        details?.account_number ?? details?.account_no ?? payload.account_no ?? null,
      accountName: details?.account_name ?? details?.accountName ?? null,
      amount: parseNumeric(details?.amount ?? data?.amount),
      fee: parseNumeric(details?.fee ?? details?.total_fee ?? data?.fee),
      data: details,
      raw: data,
    };

    return result;
  }

  async cashoutPayment(params: Ing1CashoutPaymentParams): Promise<Ing1CashoutPaymentResult> {
    const payload: Record<string, any> = {
      reff: params.reff,
    };

    if (params.clientReff) payload.client_reff = params.clientReff;
    if (params.amount != null) payload.amount = params.amount;
    if (params.otp) payload.otp = params.otp;
    if (params.remark) payload.remark = params.remark;

    const merchantId = params.merchantId ?? this.cfg.merchantId;
    if (merchantId) payload.merchant_id = merchantId;

    const data = await this.authorizedRequest<any>({
      method: 'POST',
      url: 'transaction/cashout/payment',
      data: payload,
    });

    const rc = typeof data?.rc === 'number' ? data.rc : Number(data?.rc ?? 99);

    return {
      rc,
      message: data?.message ?? '',
      status: mapRcToStatus(rc),
      reff: data?.reff ?? payload.reff,
      clientReff: data?.client_reff ?? payload.client_reff ?? null,
      data: data?.data,
      raw: data,
    };
  }

  async checkCashout(params: Ing1CashoutCheckParams): Promise<Ing1CashoutCheckResult> {
    const payload: Record<string, any> = { reff: params.reff };
    if (params.clientReff) payload.client_reff = params.clientReff;

    const data = await this.authorizedRequest<any>({
      method: 'POST',
      url: 'transaction/cashout/check',
      data: payload,
    });

    const rc = typeof data?.rc === 'number' ? data.rc : Number(data?.rc ?? 99);

    return {
      rc,
      message: data?.message ?? '',
      status: mapRcToStatus(rc),
      reff: data?.reff ?? payload.reff,
      clientReff: data?.client_reff ?? payload.client_reff ?? null,
      data: data?.data,
      raw: data,
    };
  }

  async listCashoutHistory(
    query: Ing1CashoutHistoryQuery = {}
  ): Promise<Ing1CashoutHistoryResult> {
    const params: Record<string, any> = {};
    if (query.page != null) params.page = query.page;
    if (query.perPage != null) params.per_page = query.perPage;
    if (query.startDate) params.start_date = query.startDate;
    if (query.endDate) params.end_date = query.endDate;
    if (query.clientReff) params.client_reff = query.clientReff;
    if (query.reff) params.reff = query.reff;
    if (query.status) params.status = query.status;
    if (query.custno) params.custno = query.custno;

    const data = await this.authorizedRequest<any>({
      method: 'GET',
      url: 'transaction/cashout/history',
      params,
    });

    const rc = typeof data?.rc === 'number' ? data.rc : Number(data?.rc ?? 99);
    const historiesRaw: any[] = Array.isArray(data?.histories) ? data.histories : [];

    const histories: Ing1CashoutHistoryItem[] = historiesRaw.map((item) => ({
      amount: parseNumeric(item?.amount),
      fee: parseNumeric(item?.fee ?? item?.total_fee),
      status: item?.status ?? '',
      normalizedStatus: normalizeHistoryStatus(item?.status),
      reff: item?.reff ?? null,
      clientReff: item?.client_reff ?? null,
      bankCode: item?.bank_code ?? item?.bankCode ?? null,
      bankName: item?.bank_name ?? item?.bankName ?? null,
      accountNumber: item?.account_number ?? item?.accountNo ?? null,
      accountName: item?.account_name ?? item?.accountName ?? null,
      paidAt: item?.paid_at ?? item?.paidAt ?? null,
      createdAt: item?.created_at ?? item?.createdAt ?? null,
      updatedAt: item?.updated_at ?? item?.updatedAt ?? null,
      remark: item?.remark ?? null,
      raw: item,
    }));

    const pagination = {
      currentPage: data?.current_page,
      perPage: data?.per_page,
      total: data?.total,
      lastPage: data?.last_page,
      from: data?.from,
      to: data?.to,
      hasNextPage: data?.has_next_page,
      nextPageUrl: data?.next_page_url ?? null,
      prevPageUrl: data?.prev_page_url ?? null,
    };

    return {
      rc,
      message: data?.message ?? '',
      status: mapRcToStatus(rc),
      histories,
      pagination,
      raw: data,
    };
  }
}

