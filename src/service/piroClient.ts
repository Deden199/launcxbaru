import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'
import logger from '../logger'

export interface PiroConfig {
  baseUrl: string
  clientId: string
  clientSecret: string
  signatureKey: string
  merchantId: string
  storeId?: string
  terminalId?: string
  channel?: string
  callbackUrl?: string
}

interface TokenCache {
  token: string
  expiresAt: number
}

export interface PiroCustomerInfo {
  name?: string
  email?: string
  phone?: string
}

export interface PiroCreatePaymentRequest {
  orderId: string
  amount: number
  description?: string
  channel?: string
  callbackUrl?: string
  successUrl?: string
  failureUrl?: string
  expireMinutes?: number
  customer?: PiroCustomerInfo
}

export interface PiroCreatePaymentResult {
  paymentId: string
  referenceId: string
  status: string
  checkoutUrl?: string
  qrContent?: string
  expiredAt?: string
  raw: any
}

export interface PiroStatusResult {
  paymentId: string
  referenceId: string
  status: string
  grossAmount?: number
  netAmount?: number
  feeAmount?: number
  checkoutUrl?: string
  qrContent?: string
  paidAt?: Date | null
  expiredAt?: Date | null
  settledAt?: Date | null
  raw: any
}

const trimSlash = (input: string) => input.replace(/\/+$/, '')

const parseNumber = (value: any): number | undefined => {
  if (value == null) return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

const parseDate = (value: any): Date | null => {
  if (!value) return null
  if (value instanceof Date) return value
  const str = typeof value === 'string' ? value.trim() : String(value)
  if (!str) return null
  const timestamp = Date.parse(str)
  if (!Number.isNaN(timestamp)) return new Date(timestamp)
  return null
}

const clean = <T extends Record<string, any>>(payload: T): T => {
  const clone: Record<string, any> = {}
  Object.entries(payload).forEach(([key, val]) => {
    if (val === undefined || val === null) return
    if (typeof val === 'object' && !Array.isArray(val)) {
      const nested = clean(val as Record<string, any>)
      if (Object.keys(nested).length === 0) return
      clone[key] = nested
    } else {
      clone[key] = val
    }
  })
  return clone as T
}

export class PiroClient {
  private http: AxiosInstance
  private tokenCache: TokenCache | null = null

  constructor(private readonly config: PiroConfig) {
    if (!config.baseUrl) throw new Error('Piro baseUrl is required')
    if (!config.clientId) throw new Error('Piro clientId is required')
    if (!config.clientSecret) throw new Error('Piro clientSecret is required')
    if (!config.signatureKey) throw new Error('Piro signatureKey is required')
    if (!config.merchantId) throw new Error('Piro merchantId is required')

    this.http = axios.create({
      baseURL: trimSlash(config.baseUrl),
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    })
  }

  static computeSignature(payload: string, key: string): string {
    return crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex')
  }

  verifySignature(rawBody: string, signature: string): boolean {
    const expected = PiroClient.computeSignature(rawBody, this.config.signatureKey)
    return expected === signature
  }

  clearCachedToken() {
    this.tokenCache = null
  }

  private async ensureToken(): Promise<string> {
    const now = Date.now()
    if (this.tokenCache && this.tokenCache.expiresAt - 5000 > now) {
      return this.tokenCache.token
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    })

    logger.debug('[Piro] ▶ Request token')
    const res = await this.http.post('/oauth/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const token = String(res.data?.access_token ?? res.data?.token ?? '')
    if (!token) throw new Error('Piro token response missing access_token')

    const expiresIn = Number(res.data?.expires_in ?? 3600)
    this.tokenCache = {
      token,
      expiresAt: now + expiresIn * 1000,
    }
    logger.debug('[Piro] ◀ Token acquired')
    return token
  }

  private async authorizedHeaders(): Promise<Record<string, string>> {
    const token = await this.ensureToken()
    return {
      Authorization: `Bearer ${token}`,
    }
  }

  async createPayment(payload: PiroCreatePaymentRequest): Promise<PiroCreatePaymentResult> {
    const headers = await this.authorizedHeaders()
    const body = clean({
      merchantId: this.config.merchantId,
      storeId: this.config.storeId,
      terminalId: this.config.terminalId,
      channel: payload.channel ?? this.config.channel,
      referenceId: payload.orderId,
      orderId: payload.orderId,
      amount: payload.amount,
      description: payload.description,
      callbackUrl: payload.callbackUrl ?? this.config.callbackUrl,
      successUrl: payload.successUrl,
      failureUrl: payload.failureUrl,
      expireMinutes: payload.expireMinutes,
      customer: payload.customer,
    })

    logger.info('[Piro] ▶ createPayment', { body })
    const res = await this.http.post('/v1/payments', body, { headers })
    logger.info('[Piro] ◀ createPayment', { data: res.data })
    const data = res.data?.data ?? res.data
    const payment = data?.payment ?? data

    const paymentId = String(payment?.paymentId ?? payment?.payment_id ?? payment?.id ?? '')
    const referenceId = String(payment?.referenceId ?? payment?.reference_id ?? payload.orderId)
    const status = String(payment?.status ?? '')
    const checkoutUrl =
      payment?.checkoutUrl ?? payment?.checkout_url ?? payment?.redirectUrl ?? payment?.redirect_url
    const qrContent =
      payment?.qrContent ??
      payment?.qr_content ??
      payment?.qrString ??
      payment?.qr_string ??
      payment?.qrImageUrl ??
      payment?.qr_image_url
    const expiredAt = payment?.expiredAt ?? payment?.expired_at ?? payment?.expiration_time

    return {
      paymentId,
      referenceId,
      status,
      checkoutUrl: checkoutUrl ? String(checkoutUrl) : undefined,
      qrContent: qrContent ? String(qrContent) : undefined,
      expiredAt: expiredAt ? String(expiredAt) : undefined,
      raw: res.data,
    }
  }

  async getPaymentStatus(reference: string): Promise<PiroStatusResult> {
    const headers = await this.authorizedHeaders()
    const url = `/v1/payments/${encodeURIComponent(reference)}`
    logger.info('[Piro] ▶ getPaymentStatus', { reference })
    const res = await this.http.get(url, { headers })
    logger.info('[Piro] ◀ getPaymentStatus', { data: res.data })

    const data = res.data?.data ?? res.data
    const payment = data?.payment ?? data

    const paymentId = String(payment?.paymentId ?? payment?.payment_id ?? payment?.id ?? reference)
    const referenceId = String(payment?.referenceId ?? payment?.reference_id ?? payment?.orderId ?? reference)
    const status = String(payment?.status ?? '')
    const grossAmount =
      parseNumber(payment?.grossAmount ?? payment?.gross_amount ?? payment?.amount) ?? undefined
    const netAmount = parseNumber(payment?.netAmount ?? payment?.net_amount)
    const feeAmount = parseNumber(payment?.feeAmount ?? payment?.fee_amount ?? payment?.fee)
    const checkoutUrl =
      payment?.checkoutUrl ?? payment?.checkout_url ?? payment?.redirectUrl ?? payment?.redirect_url
    const qrContent =
      payment?.qrContent ??
      payment?.qr_content ??
      payment?.qrString ??
      payment?.qr_string ??
      payment?.qrImageUrl ??
      payment?.qr_image_url

    const paidAt =
      parseDate(payment?.paidAt ?? payment?.paid_at ?? payment?.paymentTime ?? payment?.payment_time) || null
    const expiredAt =
      parseDate(payment?.expiredAt ?? payment?.expired_at ?? payment?.expiration_time ?? payment?.expires_at) || null
    const settledAt =
      parseDate(payment?.settledAt ?? payment?.settled_at ?? payment?.settlement_time ?? payment?.settlementTime) || null

    return {
      paymentId,
      referenceId,
      status,
      grossAmount,
      netAmount,
      feeAmount,
      checkoutUrl: checkoutUrl ? String(checkoutUrl) : undefined,
      qrContent: qrContent ? String(qrContent) : undefined,
      paidAt,
      expiredAt,
      settledAt,
      raw: res.data,
    }
  }
}
