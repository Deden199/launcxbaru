import { Request, Response } from 'express';
import logger from '../logger';
import { PivotCallbackBody } from '../types/pivot-callback';
import cardService from '../service/card.service';

// === Config ===
const CALLBACK_API_KEY = process.env.PIVOT_CALLBACK_API_KEY || ''; // simpan di .env

// Event yang diijinkan sesuai dok
const ALLOWED_EVENTS = new Set([
  'PAYMENT.PROCESSING',
  'PAYMENT.PAID',
  'CHARGE.SUCCESS',
  'PAYMENT.CANCELLED',
]);

/**
 * Mapper status provider -> status internal (sesuaikan dengan enum di sistemmu)
 */
function mapPaymentStatus(providerStatus?: string) {
  switch (providerStatus) {
    case 'PAID':
      return 'SUCCESS';
    case 'PROCESSING':
      return 'PENDING';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      // UNKNOWN / FAILED / dll → sesuaikan kalau ada
      return providerStatus || 'UNKNOWN';
  }
}

function toNumberSafe(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalisasi data Pivot -> shape DB internal (contoh)
 * Silakan sesuaikan dengan model prisma/mongoose kamu.
 */
function normalizePaymentForDB(data: PivotCallbackBody['data']) {
  return {
    provider: 'PIVOT',
    providerPaymentId: data.id,
    clientReferenceId: data.clientReferenceId,
    paymentType: data.paymentType, // SINGLE / MULTIPLE
    paymentMethodType: data.paymentMethod?.type, // CARD
    statementDescriptor: data.statementDescriptor,
    statusProvider: data.status, // e.g. PAID
    status: mapPaymentStatus(data.status), // e.g. SUCCESS
    amount: toNumberSafe(data.amount?.value),
    currency: data.amount?.currency || 'IDR',
    autoConfirm: !!data.autoConfirm,
    mode: data.mode, // REDIRECT
    redirectUrlSuccess: data.redirectUrl?.successReturnUrl || null,
    redirectUrlFailure: data.redirectUrl?.failureReturnUrl || null,
    redirectUrlExpiration: data.redirectUrl?.expirationReturnUrl || null,
    paymentUrl: data.paymentUrl || null,
    createdAtProvider: data.createdAt ? new Date(data.createdAt) : null,
    updatedAtProvider: data.updatedAt ? new Date(data.updatedAt) : null,
    expiryAtProvider: data.expiryAt ? new Date(data.expiryAt) : null,
    metadata: data.metadata ?? null,
  };
}
function parseDateSafe(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}


function normalizeChargeForDB(
  charge: NonNullable<PivotCallbackBody['data']>['chargeDetails'][number]
) {
  return {
    provider: 'PIVOT',
    providerChargeId: charge.id,
    providerPaymentId: charge.paymentSessionId,
    paymentSessionClientReferenceId: charge.paymentSessionClientReferenceId,
    statementDescriptor: charge.statementDescriptor,
    statusProvider: charge.status, // e.g. SUCCESS

    authorizedAmount: toNumberSafe(charge.authorizedAmount?.value),
    capturedAmount: toNumberSafe(charge.capturedAmount?.value),
    amount: toNumberSafe(charge.amount?.value),
    currency: charge.amount?.currency || 'IDR',
    isCaptured: !!charge.isCaptured,

    createdAtProvider: parseDateSafe((charge as any).createdAt),
    updatedAtProvider: parseDateSafe((charge as any).updatedAt),
    paidAtProvider: parseDateSafe((charge as any).paidAt),

    fds: charge.fdsRiskAssessment
      ? {
          score: charge.fdsRiskAssessment.score,
          level: charge.fdsRiskAssessment.level,
          recommendation: charge.fdsRiskAssessment.recommendation,
          status: charge.fdsRiskAssessment.status,
          evaluatedAt: parseDateSafe(
            (charge.fdsRiskAssessment as any).evaluatedAt
          ),
        }
      : null,
  };
}

/**
 * TODO: Ganti dengan implementasi real ke DB kamu.
 * - Gunakan upsert by providerPaymentId
 * - Terapkan idempoten berdasar updatedAtProvider (jika lebih lama → skip)
 */
async function upsertPaymentAndCharges(normalizedPayment: ReturnType<typeof normalizePaymentForDB>, chargeDetails?: PivotCallbackBody['data']['chargeDetails']) {
  // Contoh pseudo:
  // const existing = await prisma.payment.findUnique({ where: { providerPaymentId: normalizedPayment.providerPaymentId } });
  // if (existing && existing.updatedAtProvider && normalizedPayment.updatedAtProvider && existing.updatedAtProvider >= normalizedPayment.updatedAtProvider) {
  //   logger.info('[PivotCallback] Skip update (idempotent, older payload)', { id: normalizedPayment.providerPaymentId });
  //   return;
  // }
  // await prisma.$transaction(async (tx) => {
  //   await tx.payment.upsert({ ...normalizedPayment });
  //   if (Array.isArray(chargeDetails)) {
  //     for (const ch of chargeDetails) {
  //       const normCh = normalizeChargeForDB(ch);
  //       await tx.charge.upsert({
  //         where: { providerChargeId: normCh.providerChargeId },
  //         update: normCh,
  //         create: normCh,
  //       });
  //     }
  //   }
  // });

  // Untuk contoh, cukup log:
  logger.info('[PivotCallback] Upsert payment (sample)', {
    id: normalizedPayment.providerPaymentId,
    status: normalizedPayment.status,
    amount: normalizedPayment.amount,
  });

  if (Array.isArray(chargeDetails)) {
    for (const ch of chargeDetails) {
      const normCh = normalizeChargeForDB(ch);
      logger.info('[PivotCallback] Upsert charge (sample)', {
        chargeId: normCh.providerChargeId,
        status: normCh.statusProvider,
        captured: normCh.isCaptured,
      });
    }
  }
}

/**
 * Handler menerima callback dari Pivot, sesuai dok:
 * - Header: X-API-Key (wajib), Content-Type: application/json, Accept: application/json
 * - Body: { event, data{...} }
 */
export const pivotPaymentCallback = async (req: Request, res: Response) => {
  try {
    // 1) Validasi header
    const apiKey = String(req.header('x-api-key') || req.header('X-API-Key') || '');
    if (!CALLBACK_API_KEY || apiKey !== CALLBACK_API_KEY) {
      logger.warn('[PivotCallback] Invalid X-API-Key');
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const contentType = String(req.header('content-type') || '');
    if (!contentType.toLowerCase().includes('application/json')) {
      logger.warn('[PivotCallback] Invalid Content-Type', { contentType });
      return res.status(415).json({ ok: false, error: 'Unsupported Media Type' });
    }

    // (Optional) Accept header check – tidak wajib diblokir kalau kosong
    const accept = String(req.header('accept') || '');
    if (accept && !accept.toLowerCase().includes('application/json')) {
      logger.warn('[PivotCallback] Unexpected Accept header', { accept });
    }

    // 2) Validasi body minimal
    const body = req.body as PivotCallbackBody;
    if (!body || typeof body.event !== 'string' || !body.data || !body.data.id) {
      return res.status(400).json({ ok: false, error: 'Invalid callback payload' });
    }

    if (!ALLOWED_EVENTS.has(body.event)) {
      logger.warn('[PivotCallback] Event not allowed/recognized', { event: body.event });
      // Tetap 200 agar tidak di-retry tanpa guna
      return res.json({ ok: true });
    }

    // Log singkat
    logger.info('[PivotCallback] Received', {
      event: body.event,
      id: body.data.id,
      status: body.data.status,
      paymentType: body.data.paymentType,
    });

    // 3) ACK CEPAT agar Pivot tidak timeout/retry
    res.json({ ok: true });

    // 4) Proses di background (fire-and-forget)
    setImmediate(async () => {
      try {
        // Jika perlu memastikan sinkron, tarik status terbaru dari provider
        let sourceData = body.data;
        try {
          const latest = await cardService.getPayment(body.data.id);
          if (latest?.data?.id) {
            sourceData = latest.data; // sesuaikan shape hasil getPayment
            logger.info('[PivotCallback] Synced latest provider status', {
              id: body.data.id,
              status: latest.data.status,
            });
          }
        } catch (e: any) {
          logger.warn('[PivotCallback] getPayment failed; fallback to callback body', {
            id: body.data.id,
            err: e?.response?.data || e?.message,
          });
        }

        // 5) Normalisasi & upsert DB
        const normalized = normalizePaymentForDB(sourceData);
        await upsertPaymentAndCharges(normalized, sourceData.chargeDetails);

        // 6) (Opsional) Trigger proses lanjutan kalau status final (e.g., SUCCESS)
        // if (normalized.status === 'SUCCESS') await settlementQueue.enqueue(...)

      } catch (bgErr: any) {
        logger.error('[PivotCallback] Background processing error', {
          err: bgErr?.response?.data || bgErr?.message,
        });
      }
    });
  } catch (err: any) {
    logger.error('[PivotCallback] Handler error', { err: err?.response?.data || err?.message });
    // kalau belum sempat kirim response
    if (!res.headersSent) {
      return res.status(500).json({ ok: false });
    }
  }
};

export default { pivotPaymentCallback };
