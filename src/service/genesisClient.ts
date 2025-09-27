import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'
import logger from '../logger'

export interface GenesisClientConfig {
  baseUrl: string
  secret: string
  callbackUrl?: string
  defaultClientId?: string
  defaultClientSecret?: string
}

export interface GenesisRegisterPayload {
  id: string
  payload: {
    UID: string
    email: string
    mobile: string
    username: string
    password: string
    callbackClient: string
    banksAccount: {
      bankName: string
      accountNumber: string
      accountName: string
      bankBICode?: string
    }
  }
  dto: string
  collection: string
  idAdmin: string
  timestamp: number
}

export interface GenesisRegisterResult {
  UID: string
  username: string
  password: string
  callbackClient: string
  clientId: string
  clientSecret: string
  raw: any
}

export interface GenesisGenerateQrisRequest {
  orderId: string
  amount: number | string
  clientId?: string
  clientSecret?: string
}

export interface GenesisGenerateQrisResult {
  orderId: string
  tx: string
  clientId: string
  qrisData: string
  raw: any
}

export interface GenesisQueryRequest {
  orderId: string
  clientId?: string
  clientSecret?: string
}

export interface GenesisQueryResult {
  orderId: string
  tx?: string
  clientId?: string
  status: string
  responseCode?: string
  responseMessage?: string
  paidTime?: string
  amount?: number
  raw: any
}

export interface GenesisCallbackPayload {
  TX?: string
  amountSend?: number
  clientId?: string
  orderId?: string
  paymentStatus?: string
  attachment?: {
    amount?: {
      value?: string
    }
    paidTime?: string
  }
  [key: string]: any
}

const trimSlash = (input: string) => input.replace(/\/+$/, '')

const toAmountString = (value: number | string): string => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    return value.toFixed(2)
  }
  const parsed = Number(value)
  if (Number.isFinite(parsed)) return parsed.toFixed(2)
  const str = String(value)
  if (str.includes('.')) {
    const [int, frac] = str.split('.')
    return `${int}.${(frac ?? '').padEnd(2, '0').slice(0, 2)}`
  }
  if (!str) return '0.00'
  return `${str}.00`
}

const md5 = (parts: Array<string | number | undefined | null>): string => {
  const normalized = parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter((part) => part !== undefined && part !== null)
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part === 'number') return Number.isFinite(part) ? String(part) : ''
      if (part instanceof Date) return part.toISOString()
      return String(part)
    })
  return crypto.createHash('md5').update(normalized.join(''), 'utf8').digest('hex')
}

const extractAmount = (payload: GenesisCallbackPayload): string | null => {
  if (payload.attachment?.amount?.value) {
    return toAmountString(payload.attachment.amount.value)
  }
  if (payload.amountSend != null) {
    return toAmountString(payload.amountSend)
  }
  const direct = (payload as any).amount
  if (direct != null) {
    return toAmountString(direct)
  }
  return null
}

export class GenesisClient {
  private http: AxiosInstance

  constructor(private readonly config: GenesisClientConfig) {
    if (!config.baseUrl) throw new Error('Genesis baseUrl is required')
    if (!config.secret) throw new Error('Genesis secret is required')
    this.http = axios.create({
      baseURL: trimSlash(config.baseUrl),
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      proxy: false,
    })
  }

  static registrationSignature(input: {
    email: string
    username: string
    password: string
    callbackClient: string
    secret: string
  }): string {
    return md5([input.email, input.username, input.password, input.callbackClient, input.secret])
  }

  static qrisSignature(input: {
    clientId: string
    value: number | string
    orderId: string
    clientSecret: string
  }): string {
    return md5([input.clientId, toAmountString(input.value), input.orderId, input.clientSecret])
  }

  static querySignature(input: { clientId: string; orderId: string; clientSecret: string }): string {
    return md5([input.clientId, input.orderId, input.clientSecret])
  }

  static callbackSignature(payload: GenesisCallbackPayload, clientSecret: string, fallbackClientId?: string): string {
    const clientId = payload.clientId ?? (payload as any).client_id ?? fallbackClientId ?? ''
    const orderId = payload.orderId ?? (payload as any).order_id ?? ''
    const amount = extractAmount(payload) ?? '0.00'
    return GenesisClient.qrisSignature({ clientId, value: amount, orderId, clientSecret })
  }

  async registerMerchant(request: GenesisRegisterPayload): Promise<GenesisRegisterResult> {
    const callbackClient = request.payload.callbackClient || this.config.callbackUrl || ''
    const secret = this.config.secret
    const signature = GenesisClient.registrationSignature({
      email: request.payload.email,
      username: request.payload.username,
      password: request.payload.password,
      callbackClient,
      secret,
    })

    const body = {
      ...request,
      payload: {
        ...request.payload,
        callbackClient,
      },
    }

    logger.info('[Genesis] ▶ registerMerchant', { body })
    const res = await this.http.post('/user2gen/v1/user-register-create', body, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-signature': signature,
      },
    })
    logger.info('[Genesis] ◀ registerMerchant', { data: res.data })

    const data = res.data?.data ?? res.data
    return {
      UID: data?.UID ?? data?.uid ?? '',
      username: data?.username ?? '',
      password: data?.password ?? '',
      callbackClient: data?.callbackClient ?? callbackClient,
      clientId: data?.clientId ?? data?.client_id ?? '',
      clientSecret: data?.clientSecret ?? data?.client_secret ?? '',
      raw: res.data,
    }
  }

  async generateQris(payload: GenesisGenerateQrisRequest): Promise<GenesisGenerateQrisResult> {
    const clientId = payload.clientId ?? this.config.defaultClientId
    const clientSecret = payload.clientSecret ?? this.config.defaultClientSecret ?? this.config.secret

    if (!clientId) throw new Error('Genesis clientId is required for QR generation')
    if (!clientSecret) throw new Error('Genesis clientSecret is required for QR generation')

    const amount = toAmountString(payload.amount)
    const signature = GenesisClient.qrisSignature({
      clientId,
      value: amount,
      orderId: payload.orderId,
      clientSecret,
    })

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'client_id': clientId,
      'x-signature': signature,
    }

    const body = {
      value: amount,
      orderId: payload.orderId,
    }

    logger.info('[Genesis] ▶ generateQris', { headers, body })
    const res = await this.http.post('/qrissnap2gen/v1/qr-mpm-generate-order', body, { headers })
    logger.info('[Genesis] ◀ generateQris', { data: res.data })

    const data = res.data ?? {}
    return {
      orderId: data.orderId ?? payload.orderId,
      tx: data.TX ?? data.tx ?? '',
      clientId: data.clientId ?? clientId,
      qrisData: data.qrisData ?? data.qris ?? '',
      raw: res.data,
    }
  }

  async queryQris(payload: GenesisQueryRequest): Promise<GenesisQueryResult> {
    const clientId = payload.clientId ?? this.config.defaultClientId
    const clientSecret = payload.clientSecret ?? this.config.defaultClientSecret ?? this.config.secret
    if (!clientId) throw new Error('Genesis clientId is required for QR inquiry')
    if (!clientSecret) throw new Error('Genesis clientSecret is required for QR inquiry')

    const signature = GenesisClient.querySignature({
      clientId,
      orderId: payload.orderId,
      clientSecret,
    })

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'client_id': clientId,
      'x-signature': signature,
    }

    logger.info('[Genesis] ▶ queryQris', { payload })
    const res = await this.http.post('/qrissnap2gen/v1/qr-mpm-query', { orderId: payload.orderId }, { headers })
    logger.info('[Genesis] ◀ queryQris', { data: res.data })

    const data = res.data ?? {}
    const status = data.data?.transactionStatusDesc ?? data.data?.status ?? data.paymentStatus ?? ''
    const amountValue = data.data?.amount?.value ?? data.amount?.value ?? null
    const paidTime = data.data?.paidTime ?? data.attachment?.paidTime ?? null

    return {
      orderId: data.orderId ?? payload.orderId,
      tx: data.TX ?? data.tx,
      clientId: data.clientId ?? clientId,
      status: status || '',
      responseCode: data.data?.responseCode ?? data.responseCode,
      responseMessage: data.data?.responseMessage ?? data.responseMessage,
      paidTime: paidTime ?? undefined,
      amount: amountValue != null ? Number(amountValue) : undefined,
      raw: res.data,
    }
  }

  validateCallbackSignature(rawBody: string, signature: string | null | undefined, clientSecret?: string) {
    if (!signature) throw new Error('Missing Genesis signature header')
    let parsed: GenesisCallbackPayload
    try {
      parsed = JSON.parse(rawBody || '{}')
    } catch (err) {
      throw new Error('Invalid JSON payload for Genesis callback')
    }

    const secret = clientSecret ?? this.config.defaultClientSecret ?? this.config.secret
    if (!secret) throw new Error('Genesis clientSecret is required for callback validation')
    const expected = GenesisClient.callbackSignature(parsed, secret, this.config.defaultClientId)
    if (signature !== expected) {
      throw new Error('Invalid Genesis signature')
    }

    return parsed
  }
}

export const formatGenesisAmount = toAmountString
