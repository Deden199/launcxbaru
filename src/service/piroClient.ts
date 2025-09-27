import axios, { AxiosError, AxiosInstance } from 'axios'
import crypto from 'crypto'
import moment from 'moment-timezone'
import { Buffer } from 'node:buffer'
import logger from '../logger'

export interface PiroConfig {
  baseUrl: string
  clientId: string
  clientSecret?: string
  signatureKey: string
  merchantId: string
  storeId?: string
  terminalId?: string
  channel?: string
  callbackUrl?: string
}

const JAKARTA_TIMEZONE = 'Asia/Jakarta'

export interface PiroDailyCredential {
  username: string
  password: string
  millis: number
}

export function jakartaDailyMillis(at: Date = new Date()): number {
  return moment(at).tz(JAKARTA_TIMEZONE).startOf('day').valueOf()
}

export function piroDailyCredentials(at: Date = new Date()): PiroDailyCredential {
  const millis = jakartaDailyMillis(at)
  return {
    username: `piro-${millis}`,
    password: String(millis),
    millis,
  }
}

export function piroBasicAuthorization(at: Date = new Date()): string {
  const { username, password } = piroDailyCredentials(at)
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
  return `Basic ${token}`
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

export interface PiroValidateAccountRequest {
  accountNumber: string
  bankCode: string
  /**
   * Optional branch code required for certain banks (derived from Piro docs).
   */
  branchCode?: string
  /**
   * Additional bank identifier (often the internal code that Piro expects).
   */
  bankIdentifier?: string
  /** Friendly bank name used when the API response omits the label. */
  bankName?: string
}

export interface PiroValidateAccountResult {
  isValid: boolean
  accountNumber: string
  accountName?: string
  bankCode?: string
  bankName?: string
  branchCode?: string
  bankIdentifier?: string
  responseCode?: string
  message?: string
  raw: any
}

export interface PiroWithdrawalRequest {
  referenceId: string
  amount: number
  bankCode: string
  accountNumber: string
  accountName: string
  accountAlias?: string
  branchCode?: string
  bankIdentifier?: string
  description?: string
  callbackUrl?: string
  metadata?: Record<string, any>
}

export interface PiroWithdrawalResult {
  success: boolean
  status: string
  withdrawalId?: string
  referenceId?: string
  accountName?: string
  bankName?: string
  branchName?: string
  feeAmount?: number
  message?: string
  responseCode?: string
  raw: any
}

export interface PiroWithdrawalStatusResult {
  status: string
  withdrawalId?: string
  referenceId?: string
  accountName?: string
  bankName?: string
  branchName?: string
  feeAmount?: number
  completedAt?: Date | null
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

  constructor(private readonly config: PiroConfig) {
    if (!config.baseUrl) throw new Error('Piro baseUrl is required')
    if (!config.clientId) throw new Error('Piro clientId is required')
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

  private async authorizedHeaders(at: Date = new Date()): Promise<Record<string, string>> {
    return {
      Authorization: piroBasicAuthorization(at),
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

  private unwrapData(res: any): any {
    return res?.data?.data ?? res?.data ?? res
  }

  private extractError(error: any): { raw: any; message?: string; code?: string } {
    if (!error) return { raw: error }
    if (error instanceof Error && !(error as AxiosError).isAxiosError) {
      return { raw: error, message: error.message }
    }

    const axiosErr = error as AxiosError<any>
    const payload = axiosErr.response?.data ?? axiosErr.toJSON?.() ?? axiosErr
    const message =
      payload?.message ??
      payload?.error ??
      payload?.errorMessage ??
      axiosErr.message
    const code =
      payload?.code ?? payload?.errorCode ?? payload?.error_code ?? payload?.statusCode

    return {
      raw: payload,
      message: typeof message === 'string' ? message : undefined,
      code: typeof code === 'string' || typeof code === 'number' ? String(code) : undefined,
    }
  }

  async validateBankAccount(payload: PiroValidateAccountRequest): Promise<PiroValidateAccountResult> {
    const headers = await this.authorizedHeaders()
    const body = clean({
      merchantId: this.config.merchantId,
      referenceId: `acct-${Date.now()}`,
      accountNumber: payload.accountNumber,
      bankCode: payload.bankCode,
      branchCode: payload.branchCode,
      bankIdentifier: payload.bankIdentifier,
    })

    try {
      logger.info('[Piro] ▶ validateBankAccount', { body })
      const res = await this.http.post('/v1/disbursements/account-validation', body, { headers })
      logger.info('[Piro] ◀ validateBankAccount', { data: res.data })
      const data = this.unwrapData(res)
      const result = data?.result ?? data

      const status = String(result?.status ?? data?.status ?? '').toUpperCase()
      const responseCode =
        result?.code ??
        result?.responseCode ??
        result?.response_code ??
        data?.code ??
        data?.responseCode ??
        data?.response_code

      const errorCode =
        result?.errorCode ??
        result?.error_code ??
        data?.errorCode ??
        data?.error_code ??
        null

      const message =
        result?.message ??
        data?.message ??
        res.data?.message ??
        null

      const success =
        !errorCode && !['FAILED', 'INVALID', 'ERROR', 'REJECTED'].includes(status)

      const bankName =
        result?.bankName ??
        result?.bank_name ??
        data?.bankName ??
        data?.bank_name ??
        payload.bankName

      return {
        isValid: success,
        accountNumber:
          result?.accountNumber ?? result?.account_number ?? data?.accountNumber ?? payload.accountNumber,
        accountName: result?.accountName ?? result?.account_name ?? data?.accountName ?? undefined,
        bankCode: result?.bankCode ?? result?.bank_code ?? data?.bankCode ?? payload.bankCode,
        bankName,
        branchCode: result?.branchCode ?? result?.branch_code ?? payload.branchCode,
        bankIdentifier:
          result?.bankIdentifier ??
          result?.bank_identifier ??
          data?.bankIdentifier ??
          data?.bank_identifier ??
          payload.bankIdentifier,
        responseCode:
          responseCode != null && responseCode !== '' ? String(responseCode) : undefined,
        message: typeof message === 'string' ? message : undefined,
        raw: res.data,
      }
    } catch (err) {
      const { raw, message, code } = this.extractError(err)
      return {
        isValid: false,
        accountNumber: payload.accountNumber,
        bankCode: payload.bankCode,
        bankName: payload.bankName,
        branchCode: payload.branchCode,
        bankIdentifier: payload.bankIdentifier,
        responseCode: code,
        message,
        raw,
      }
    }
  }

  async createWithdrawal(payload: PiroWithdrawalRequest): Promise<PiroWithdrawalResult> {
    const headers = await this.authorizedHeaders()
    const body = clean({
      merchantId: this.config.merchantId,
      storeId: this.config.storeId,
      terminalId: this.config.terminalId,
      channel: this.config.channel,
      callbackUrl: payload.callbackUrl ?? this.config.callbackUrl,
      referenceId: payload.referenceId,
      amount: payload.amount,
      accountNumber: payload.accountNumber,
      accountName: payload.accountName,
      accountAlias: payload.accountAlias,
      bankCode: payload.bankCode,
      branchCode: payload.branchCode,
      bankIdentifier: payload.bankIdentifier,
      description: payload.description,
      metadata: payload.metadata,
    })

    try {
      logger.info('[Piro] ▶ createWithdrawal', { body })
      const res = await this.http.post('/v1/disbursements', body, { headers })
      logger.info('[Piro] ◀ createWithdrawal', { data: res.data })
      const data = this.unwrapData(res)
      const result = data?.disbursement ?? data

      const status = String(result?.status ?? data?.status ?? '').toUpperCase()
      const success = ['SUCCESS', 'COMPLETED', 'PAID'].includes(status)
      const responseCode =
        result?.code ??
        result?.responseCode ??
        result?.response_code ??
        data?.code ??
        data?.responseCode ??
        data?.response_code

      const fee = result?.fee ?? result?.feeAmount ?? result?.fee_amount ?? data?.fee

      return {
        success,
        status,
        withdrawalId:
          result?.disbursementId ??
          result?.withdrawalId ??
          result?.id ??
          data?.disbursementId ??
          data?.withdrawalId ??
          undefined,
        referenceId:
          result?.referenceId ??
          result?.reference_id ??
          data?.referenceId ??
          payload.referenceId,
        accountName: result?.accountName ?? data?.accountName,
        bankName: result?.bankName ?? data?.bankName,
        branchName: result?.branchName ?? data?.branchName,
        feeAmount: typeof fee === 'number' ? fee : parseNumber(fee),
        message: result?.message ?? data?.message ?? res.data?.message,
        responseCode: responseCode != null ? String(responseCode) : undefined,
        raw: res.data,
      }
    } catch (err) {
      const { raw, message, code } = this.extractError(err)
      return {
        success: false,
        status: 'FAILED',
        referenceId: payload.referenceId,
        message,
        responseCode: code,
        raw,
      }
    }
  }

  async getWithdrawalStatus(reference: string): Promise<PiroWithdrawalStatusResult> {
    const headers = await this.authorizedHeaders()
    const url = `/v1/disbursements/${encodeURIComponent(reference)}`
    logger.info('[Piro] ▶ getWithdrawalStatus', { reference })
    const res = await this.http.get(url, { headers })
    logger.info('[Piro] ◀ getWithdrawalStatus', { data: res.data })

    const data = this.unwrapData(res)
    const result = data?.disbursement ?? data

    const status = String(result?.status ?? data?.status ?? '').toUpperCase()
    const fee = result?.fee ?? result?.feeAmount ?? result?.fee_amount ?? data?.fee
    const completed =
      parseDate(result?.completedAt ?? result?.completed_at ?? data?.completedAt ?? data?.completed_at) ??
      parseDate(result?.settledAt ?? result?.settled_at) ??
      null

    return {
      status,
      withdrawalId:
        result?.disbursementId ??
        result?.withdrawalId ??
        result?.id ??
        data?.disbursementId ??
        data?.withdrawalId ??
        undefined,
      referenceId:
        result?.referenceId ??
        result?.reference_id ??
        data?.referenceId ??
        reference,
      accountName: result?.accountName ?? data?.accountName,
      bankName: result?.bankName ?? data?.bankName,
      branchName: result?.branchName ?? data?.branchName,
      feeAmount: typeof fee === 'number' ? fee : parseNumber(fee),
      completedAt: completed,
      raw: res.data,
    }
  }
}
