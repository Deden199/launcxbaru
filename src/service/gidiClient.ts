/* ───────────────────────── src/service/gidiClient.ts ───────────────────────── */

import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'

export class GidiError extends Error {
  constructor(public code: string, message: string) {
    super(`${message} (${code})`)
    this.name = 'GidiError'
  }
}

export interface GidiDisbursementConfig {
  baseUrl: string
  merchantId: string
  credentialKey: string
}

/**
 * Minimal Gidi client for disbursement (BI Fast / RTOL).
 * Only the endpoints required for withdrawal are implemented.
 */
export class GidiClient {
  private axiosInst: AxiosInstance

  constructor(private cfg: GidiDisbursementConfig) {
    this.axiosInst = axios.create({
      baseURL: cfg.baseUrl,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    })
  }

  private signInquiry(requestId: string): string {
    const inner = crypto
      .createHash('sha256')
      .update(requestId + this.cfg.credentialKey)
      .digest('hex')
    return crypto
      .createHash('sha256')
      .update(this.cfg.merchantId + inner)
      .digest('hex')
  }

  async inquiryAccount(channelId: string, accountNo: string, requestId: string) {
    const body = {
      merchantId: Number(this.cfg.merchantId),
      requestId,
      channelId,
      accountNo,
      signature: this.signInquiry(requestId),
    }
    const { data } = await this.axiosInst.post('/Transfer/InquiryAccount', body)
    if (data.responseCode !== 'SUCCESS') {
      throw new GidiError(data.responseCode, data.responseMessage)
    }
    return data.responseDetail
  }

  private signTransfer(
    requestId: string,
    transactionId: string,
    channelId: string,
    amount: number,
    methodFee: string
  ) {
    const innerRaw = `${requestId}${transactionId}${channelId}${methodFee}${amount}${this.cfg.credentialKey}`
    const inner = crypto.createHash('sha256').update(innerRaw).digest('hex')
    return crypto
      .createHash('sha256')
      .update(this.cfg.merchantId + inner)
      .digest('hex')
  }

  async createTransfer(params: {
    requestId: string
    transactionId: string
    channelId: string
    accountNo: string
    amount: number
    transferNote?: string
  }) {
    const methodFee = 'Merchant'
    const body = {
      merchantId: Number(this.cfg.merchantId),
      requestId: params.requestId,
      transactionId: params.transactionId,
      channelId: params.channelId,
      accountNo: params.accountNo,
      methodFee,
      amount: params.amount,
      transferNote: params.transferNote ?? '',
      signature: this.signTransfer(
        params.requestId,
        params.transactionId,
        params.channelId,
        params.amount,
        methodFee
      ),
    }
    const { data } = await this.axiosInst.post('/Transfer/Bifast', body)
    if (data.responseCode !== 'SUCCESS') {
      throw new GidiError(data.responseCode, data.responseMessage)
    }
    return data.responseDetail
  }

  private signQuery(requestId: string, transactionId: string) {
    const innerRaw = `${requestId}${transactionId}${this.cfg.credentialKey}`
    const inner = crypto.createHash('sha256').update(innerRaw).digest('hex')
    return crypto
      .createHash('sha256')
      .update(this.cfg.merchantId + inner)
      .digest('hex')
  }

  async queryTransfer(requestId: string, transactionId: string) {
    const body = {
      merchantId: Number(this.cfg.merchantId),
      requestId,
      transactionId,
      signature: this.signQuery(requestId, transactionId),
    }
    const { data } = await this.axiosInst.post('/Transfer/BifastQuery', body)
    if (data.responseCode !== 'SUCCESS') {
      throw new GidiError(data.responseCode, data.responseMessage)
    }
    return data.responseDetail
  }
}

