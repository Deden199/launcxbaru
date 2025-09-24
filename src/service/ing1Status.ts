import crypto from 'crypto';
import moment from 'moment-timezone';
import logger from '../logger';
import { prisma } from '../core/prisma';
import { computeSettlement } from './feeSettlement';
import { isJakartaWeekend, wibTimestamp, wibTimestampString } from '../util/time';

export type Ing1InternalStatus = 'PAID' | 'PENDING' | 'FAILED';

const normalizeNumber = (value: unknown): number | null => {
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

const normalizeRc = (rc?: number | null): Ing1InternalStatus | null => {
  if (rc == null || Number.isNaN(rc)) return null;
  if (rc === 0) return 'PAID';
  if (rc === 91) return 'PENDING';
  if (rc === 99) return 'FAILED';
  return null;
};

const normalizeStatusText = (status?: string | null): Ing1InternalStatus | null => {
  if (!status) return null;
  const lowered = status.toLowerCase();
  if (['success', 'paid', 'complete', 'completed', 'done'].includes(lowered)) {
    return 'PAID';
  }
  if (['pending', 'process', 'processing'].includes(lowered)) {
    return 'PENDING';
  }
  if (['failed', 'fail', 'cancel', 'cancelled', 'expired', 'reject', 'rejected', 'void'].includes(lowered)) {
    return 'FAILED';
  }
  return null;
};

export const mapIng1Status = (
  rc?: number | null,
  statusText?: string | null
): Ing1InternalStatus => {
  const byRc = normalizeRc(rc);
  if (byRc) return byRc;
  const byText = normalizeStatusText(statusText);
  if (byText) return byText;
  return 'FAILED';
};

export const parseIng1Date = (value: unknown): Date | null => {
  if (value == null) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace('T', ' ');
  const formats = [
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DD HH:mm:ssZ',
    'YYYY-MM-DDTHH:mm:ssZ',
  ];

  for (const fmt of formats) {
    const parsed = moment.tz(normalized, fmt, 'Asia/Jakarta');
    if (parsed.isValid()) return parsed.toDate();
  }

  const fallback = moment.tz(trimmed, 'Asia/Jakarta');
  if (fallback.isValid()) return fallback.toDate();

  const jsDate = new Date(trimmed);
  return Number.isNaN(jsDate.getTime()) ? null : jsDate;
};

export const parseIng1Number = (value: unknown): number | null => normalizeNumber(value);

export interface Ing1UpdatePayload {
  orderId: string;
  rc?: number | null;
  statusText?: string | null;
  billerReff?: string | null;
  clientReff?: string | null;
  grossAmount?: number | null;
  paymentReceivedTime?: Date | null | undefined;
  settlementTime?: Date | null | undefined;
  expirationTime?: Date | null | undefined;
}

export interface Ing1UpdateResult {
  newStatus: string;
  previousStatus: string;
  forwarded: boolean;
}

export async function processIng1Update(payload: Ing1UpdatePayload): Promise<Ing1UpdateResult> {
  const { orderId } = payload;
  if (!orderId) throw new Error('Missing orderId for ING1 update');

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      amount: true,
      feeLauncx: true,
      pendingAmount: true,
      qrPayload: true,
      status: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found for ING1 update`);
  }

  const previousStatus = order.status;
  if (previousStatus === 'SETTLED') {
    logger.info(`[ING1] Order ${orderId} already settled; skipping update`);
    return { newStatus: previousStatus, previousStatus, forwarded: false };
  }

  const rc = payload.rc != null ? Number(payload.rc) : null;
  const mappedStatus = mapIng1Status(rc, payload.statusText);
  const isSuccess = mappedStatus === 'PAID';

  let settlementStatus = payload.statusText?.toUpperCase() || null;
  if (!settlementStatus) {
    settlementStatus = isSuccess ? 'PENDING' : 'FAILED';
  }

  const grossAmount =
    payload.grossAmount != null && !Number.isNaN(payload.grossAmount)
      ? payload.grossAmount
      : order.amount;

  const partner = await prisma.partnerClient.findUnique({
    where: { id: order.userId },
    select: {
      feePercent: true,
      feeFlat: true,
      weekendFeePercent: true,
      weekendFeeFlat: true,
      callbackUrl: true,
      callbackSecret: true,
    },
  });

  if (!partner) {
    throw new Error(`PartnerClient ${order.userId} not found for ING1 update`);
  }

  const weekend = isJakartaWeekend(payload.paymentReceivedTime ?? new Date());
  const pctFee = weekend ? partner.weekendFeePercent ?? 0 : partner.feePercent ?? 0;
  const flatFee = weekend ? partner.weekendFeeFlat ?? 0 : partner.feeFlat ?? 0;
  const { fee: feeLauncx, settlement } = computeSettlement(grossAmount, {
    percent: pctFee,
    flat: flatFee,
  });

  const pendingAmount = isSuccess ? settlement : null;

  const updateData: any = {
    status: mappedStatus,
    settlementStatus,
    fee3rdParty: 0,
    feeLauncx: isSuccess ? feeLauncx : null,
    pendingAmount,
    settlementAmount: isSuccess ? null : grossAmount,
    updatedAt: wibTimestamp(),
  };

  if (payload.paymentReceivedTime !== undefined) {
    updateData.paymentReceivedTime = payload.paymentReceivedTime;
  }
  if (payload.settlementTime !== undefined) {
    updateData.settlementTime = payload.settlementTime;
  }
  if (payload.expirationTime !== undefined) {
    updateData.trxExpirationTime = payload.expirationTime;
  }
  if (payload.billerReff) {
    updateData.pgRefId = payload.billerReff;
  }
  if (payload.clientReff) {
    updateData.pgClientRef = payload.clientReff;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: updateData,
  });

  let forwarded = false;
  if (isSuccess && previousStatus !== 'PAID' && partner.callbackUrl && partner.callbackSecret) {
    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    if (updated) {
      const timestamp = wibTimestampString();
      const nonce = crypto.randomUUID();
      const payloadToSend = {
        orderId,
        status: mappedStatus,
        settlementStatus,
        grossAmount: updated.amount,
        feeLauncx: updated.feeLauncx,
        netAmount: updated.pendingAmount,
        qrPayload: updated.qrPayload,
        timestamp,
        nonce,
      };
      const signature = crypto
        .createHmac('sha256', partner.callbackSecret)
        .update(JSON.stringify(payloadToSend))
        .digest('hex');

      await prisma.callbackJob.create({
        data: {
          url: partner.callbackUrl,
          payload: payloadToSend,
          signature,
          partnerClientId: updated.userId,
        },
      });
      forwarded = true;
      logger.info('[ING1] Enqueued callback to partner');
    }
  }

  return { newStatus: mappedStatus, previousStatus, forwarded };
}
