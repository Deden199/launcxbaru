import crypto from 'crypto'
import logger from '../logger'
import { prisma } from '../core/prisma'
import { computeSettlement } from './feeSettlement'
import { isJakartaWeekend, wibTimestamp, wibTimestampString } from '../util/time'

export interface PiroUpdateInput {
  orderId: string
  status: string
  paymentId?: string | null
  referenceId?: string | null
  grossAmount?: number
  netAmount?: number
  feeAmount?: number
  checkoutUrl?: string | null
  qrContent?: string | null
  paymentReceivedTime?: Date | string | null
  settlementTime?: Date | string | null
  expirationTime?: Date | string | null
  raw?: any
}

const parseDate = (value: any): Date | undefined => {
  if (!value) return undefined
  if (value instanceof Date) return value
  const str = typeof value === 'string' ? value.trim() : String(value)
  if (!str) return undefined
  const ts = Date.parse(str)
  if (Number.isNaN(ts)) return undefined
  return new Date(ts)
}

export async function processPiroUpdate(input: PiroUpdateInput): Promise<void> {
  const orderId = input.orderId
  if (!orderId) throw new Error('orderId is required for Piro update')

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      userId: true,
      partnerClientId: true,
      amount: true,
      qrPayload: true,
    },
  })

  if (!order) throw new Error(`Order ${orderId} not found`)

  if (order.status === 'SETTLED') {
    logger.info(`[Piro] Order ${orderId} already settled; skipping status update`)
    return
  }

  const statusUpper = (input.status || '').toUpperCase()
  const isSuccess = ['SUCCESS', 'PAID', 'DONE', 'COMPLETED', 'SETTLED'].includes(statusUpper)
  const isFailed = ['FAILED', 'CANCELLED', 'EXPIRED', 'VOID', 'ERROR'].includes(statusUpper)
  const newStatus = statusUpper || order.status
  const settlementStatus = isSuccess ? 'PENDING' : isFailed ? statusUpper : null

  const paymentReceivedTime =
    parseDate(input.paymentReceivedTime) ?? (isSuccess ? wibTimestamp() : undefined)
  const settlementTime = parseDate(input.settlementTime) ?? null
  const expirationTime = parseDate(input.expirationTime)

  const partnerId = order.partnerClientId ?? order.userId
  if (!partnerId) throw new Error(`Order ${orderId} missing partner client`)

  const partner = await prisma.partnerClient.findUnique({
    where: { id: partnerId },
    select: {
      feePercent: true,
      feeFlat: true,
      weekendFeePercent: true,
      weekendFeeFlat: true,
      callbackUrl: true,
      callbackSecret: true,
    },
  })
  if (!partner) throw new Error(`PartnerClient ${partnerId} not found`)

  const grossAmount = input.grossAmount ?? order.amount
  const weekend = isJakartaWeekend(paymentReceivedTime ?? wibTimestamp())
  const percent = weekend ? partner.weekendFeePercent ?? 0 : partner.feePercent ?? 0
  const flat = weekend ? partner.weekendFeeFlat ?? 0 : partner.feeFlat ?? 0
  const { fee: feeLauncx, settlement } = computeSettlement(grossAmount, { percent, flat })

  const updateData: any = {
    status: isSuccess ? 'PAID' : newStatus,
    settlementStatus,
    fee3rdParty: input.feeAmount ?? undefined,
    feeLauncx: isSuccess ? feeLauncx : null,
    pendingAmount: isSuccess ? settlement : null,
    settlementAmount: isSuccess ? null : input.netAmount ?? null,
    paymentReceivedTime: paymentReceivedTime ?? undefined,
    settlementTime,
    trxExpirationTime: expirationTime ?? undefined,
    pgRefId: input.paymentId ?? undefined,
    pgClientRef: input.referenceId ?? undefined,
    checkoutUrl: input.checkoutUrl ?? undefined,
    qrPayload: input.qrContent ?? undefined,
    updatedAt: wibTimestamp(),
  }

  if (input.raw) {
    updateData.providerPayload = input.raw as any
  }

  await prisma.order.update({
    where: { id: orderId },
    data: updateData,
  })

  if (input.raw) {
    const existingCb = await prisma.transaction_callback.findFirst({
      where: { referenceId: orderId },
    })

    if (existingCb) {
      await prisma.transaction_callback.update({
        where: { id: existingCb.id },
        data: {
          requestBody: input.raw as any,
          updatedAt: wibTimestamp(),
          paymentReceivedTime: paymentReceivedTime ?? null,
          settlementTime,
          trxExpirationTime: expirationTime ?? null,
        },
      })
    } else {
      await prisma.transaction_callback.create({
        data: {
          referenceId: orderId,
          requestBody: input.raw as any,
          paymentReceivedTime: paymentReceivedTime ?? null,
          settlementTime,
          trxExpirationTime: expirationTime ?? null,
        },
      })
    }
  }

  const updated = await prisma.order.findUnique({ where: { id: orderId } })

  if (isSuccess && partner.callbackUrl && partner.callbackSecret && updated) {
    const timestamp = wibTimestampString()
    const nonce = crypto.randomUUID()
    const payload = {
      orderId,
      status: 'PAID',
      settlementStatus: settlementStatus ?? 'PENDING',
      grossAmount: updated.amount,
      feeLauncx: updated.feeLauncx,
      netAmount: updated.pendingAmount,
      qrPayload: updated.qrPayload ?? order.qrPayload ?? null,
      timestamp,
      nonce,
    }

    const signature = crypto
      .createHmac('sha256', partner.callbackSecret)
      .update(JSON.stringify(payload))
      .digest('hex')

    await prisma.callbackJob.create({
      data: {
        url: partner.callbackUrl,
        payload,
        signature,
        partnerClientId: partnerId,
      },
    })
    logger.info(`[Piro] Enqueued callback job for order ${orderId}`)
  }
}
