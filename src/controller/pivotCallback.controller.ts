import { Request, Response } from 'express';
import logger from '../logger';
import { PivotCallbackBody } from '../types/pivot-callback';
import cardService from '../service/card.service';

const CALLBACK_API_KEY = process.env.PIVOT_CALLBACK_API_KEY || '';
const DEFAULT_ALLOWED_EVENTS = [
  'PAYMENT.PROCESSING',
  'PAYMENT.PAID',
  'CHARGE.SUCCESS',
  'PAYMENT.CANCELLED',
  'PAYMENT.TEST',
];

const envEvents = process.env.PIVOT_CALLBACK_ALLOWED_EVENTS
  ?.split(',')
  .map((e) => e.trim())
  .filter(Boolean);

const ALLOWED_EVENTS = new Set(envEvents?.length ? envEvents : DEFAULT_ALLOWED_EVENTS);

function parseDateSafe(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toNumberSafe(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapPaymentStatus(providerStatus?: string) {
  switch (providerStatus) {
    case 'PAID': return 'SUCCESS';
    case 'PROCESSING': return 'PENDING';
    case 'CANCELLED': return 'CANCELLED';
    default: return providerStatus || 'UNKNOWN';
  }
}

// --- Robust body parsing (body or rawBody, string/buffer) ---
function getParsedBody(req: Request): any {
  const b: any = (req as any).body;
  if (b && typeof b === 'object') return b;

  const raw = (req as any).rawBody;
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw); } catch {}
  }
  if (raw instanceof Buffer && raw.length) {
    try { return JSON.parse(raw.toString('utf8')); } catch {}
  }
  if (typeof b === 'string' && b.trim()) {
    try { return JSON.parse(b); } catch {}
  }
  return b ?? {};
}

// --- Flexible extractors ---
function extractEvent(body: any): string | undefined {
  return (
    (typeof body?.event === 'string' && body.event) ||
    (typeof body?.type === 'string' && body.type) ||
    (typeof body?.eventType === 'string' && body.eventType) ||
    undefined
  );
}
function extractPaymentId(body: any): string | undefined {
  const topLevel =
    body?.data?.id ??
    body?.data?.paymentSessionId ??
    body?.id ??
    body?.paymentId ??
    body?.paymentSessionId ??
    body?.payment?.id ??
    body?.charge?.paymentSessionId;

  if (topLevel) return topLevel;

  const chargeDetails = body?.data?.chargeDetails;
  if (Array.isArray(chargeDetails)) {
    for (const ch of chargeDetails) {
      const sid = ch?.paymentSessionId || ch?.paymentSessionClientReferenceId;
      if (typeof sid === 'string' && sid) return sid;
    }
  }

  const rootChargeDetails = body?.chargeDetails;
  if (Array.isArray(rootChargeDetails)) {
    for (const ch of rootChargeDetails) {
      const sid = ch?.paymentSessionId || ch?.paymentSessionClientReferenceId;
      if (typeof sid === 'string' && sid) return sid;
    }
  }

  return undefined;
}

// --- Normalizers (unchanged logic, just types defensive) ---
function normalizePaymentForDB(data: PivotCallbackBody['data']) {
  return {
    provider: 'PIVOT',
    providerPaymentId: (data as any).id ?? (data as any).paymentSessionId,
    clientReferenceId: (data as any).clientReferenceId,
    paymentType: (data as any).paymentType,
    paymentMethodType: (data as any).paymentMethod?.type,
    statementDescriptor: (data as any).statementDescriptor,
    statusProvider: (data as any).status,
    status: mapPaymentStatus((data as any).status),
    amount: toNumberSafe((data as any).amount?.value),
    currency: (data as any).amount?.currency || 'IDR',
    autoConfirm: !!(data as any).autoConfirm,
    mode: (data as any).mode,
    redirectUrlSuccess: (data as any).redirectUrl?.successReturnUrl ?? null,
    redirectUrlFailure: (data as any).redirectUrl?.failureReturnUrl ?? null,
    redirectUrlExpiration: (data as any).redirectUrl?.expirationReturnUrl ?? null,
    paymentUrl: (data as any).paymentUrl ?? null,
    createdAtProvider: parseDateSafe((data as any).createdAt),
    updatedAtProvider: parseDateSafe((data as any).updatedAt),
    expiryAtProvider: parseDateSafe((data as any).expiryAt),
    metadata: (data as any).metadata ?? null,
  };
}

function normalizeChargeForDB(
  charge: NonNullable<PivotCallbackBody['data']>['chargeDetails'][number]
) {
  return {
    provider: 'PIVOT',
    providerChargeId: (charge as any).id,
    providerPaymentId: (charge as any).paymentSessionId,
    paymentSessionClientReferenceId: (charge as any).paymentSessionClientReferenceId,
    statementDescriptor: (charge as any).statementDescriptor,
    statusProvider: (charge as any).status,
    authorizedAmount: toNumberSafe((charge as any).authorizedAmount?.value),
    capturedAmount: toNumberSafe((charge as any).capturedAmount?.value),
    amount: toNumberSafe((charge as any).amount?.value),
    currency: (charge as any).amount?.currency || 'IDR',
    isCaptured: !!(charge as any).isCaptured,
    createdAtProvider: parseDateSafe((charge as any).createdAt),
    updatedAtProvider: parseDateSafe((charge as any).updatedAt),
    paidAtProvider: parseDateSafe((charge as any).paidAt),
    fds: (charge as any).fdsRiskAssessment
      ? {
          score: (charge as any).fdsRiskAssessment.score,
          level: (charge as any).fdsRiskAssessment.level,
          recommendation: (charge as any).fdsRiskAssessment.recommendation,
          status: (charge as any).fdsRiskAssessment.status,
          evaluatedAt: parseDateSafe((charge as any).fdsRiskAssessment.evaluatedAt),
        }
      : null,
  };
}

// TODO: replace with real DB upsert
async function upsertPaymentAndCharges(
  normalizedPayment: ReturnType<typeof normalizePaymentForDB>,
  chargeDetails?: PivotCallbackBody['data']['chargeDetails']
) {
  logger.info('[PivotCallback] Upsert payment (sample)', {
    id: normalizedPayment.providerPaymentId,
    status: normalizedPayment.status,
    amount: normalizedPayment.amount,
  });
  if (Array.isArray(chargeDetails)) {
    for (const ch of chargeDetails as any[]) {
      const normCh = normalizeChargeForDB(ch);
      logger.info('[PivotCallback] Upsert charge (sample)', {
        chargeId: normCh.providerChargeId,
        status: normCh.statusProvider,
        captured: normCh.isCaptured,
      });
    }
  }
}

// === FINAL HANDLER (robust) ===
export const pivotPaymentCallback = async (req: Request, res: Response) => {
  try {
    // 0) API Key (jika diaktifkan)
    if (CALLBACK_API_KEY) {
      const apiKey = String(req.header('x-api-key') || req.header('X-API-Key') || '');
      if (apiKey !== CALLBACK_API_KEY) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    // 1) Content-Type longgar (application/json, */json, +json)
    const ct = String(req.header('content-type') || '').toLowerCase();
    if (ct && !(ct.includes('application/json') || ct.endsWith('/json') || ct.includes('+json'))) {
      // Jangan blokir dengan 415 — provider kadang salah header. Cukup warning.
      logger.warn('[PivotCallback] Unexpected Content-Type', { contentType: ct });
    }

    // 2) Parse body defensif
    const anyBody = getParsedBody(req);
    const event = extractEvent(anyBody);
    const paymentId = extractPaymentId(anyBody);

    if (!event) {
      logger.warn('[PivotCallback] Missing event', {
        ct,
        len: req.headers['content-length'],
        sample: JSON.stringify(anyBody).slice(0, 800),
      });
      return res.status(400).json({ ok: false, error: 'Missing event' });
    }
    if (event !== 'PAYMENT.TEST' && !paymentId) {
      logger.warn('[PivotCallback] Missing payment ID', {
        ct,
        len: req.headers['content-length'],
        sample: JSON.stringify(anyBody).slice(0, 800),
      });
      return res.status(400).json({
        ok: false,
        error: 'Missing payment ID (expected data.id or paymentSessionId)',
      });
    }

    // 3) Whitelist event (kalau mau tetap strict)
    if (!ALLOWED_EVENTS.has(event)) {
      logger.warn('[PivotCallback] Event not allowed/recognized', { event });
      return res.status(200).json({ ok: true });
    }

    // 4) ACK cepat
    res.status(200).type('application/json').send(JSON.stringify({ ok: true }));

    // Skip background processing for test callbacks
    if (event === 'PAYMENT.TEST') return;

    // 5) Background processing
    setImmediate(async () => {
      try {
        logger.info('[PivotCallback] Received', {
          event,
          id: paymentId,
          status: anyBody?.data?.status ?? anyBody?.status,
        });

        // Sync status terbaru (opsional)
        let sourceData = (anyBody as PivotCallbackBody).data as any;
        try {
          const latest = await cardService.getPayment(paymentId);
          if (latest?.data?.id) {
            sourceData = latest.data;
            logger.info('[PivotCallback] Synced latest provider status', {
              id: paymentId,
              status: latest.data.status,
            });
          }
        } catch (e: any) {
          logger.warn('[PivotCallback] getPayment failed; fallback to callback body', {
            id: paymentId,
            err: e?.response?.data || e?.message,
          });
        }

        // Normalize & upsert
        if (sourceData) {
          const normalized = normalizePaymentForDB(sourceData);
          await upsertPaymentAndCharges(normalized, (sourceData as any).chargeDetails);
        }
      } catch (bgErr: any) {
        logger.error('[PivotCallback] Background processing error', {
          err: bgErr?.response?.data || bgErr?.message,
        });
      }
    });
  } catch (err: any) {
    logger.error('[PivotCallback] Handler error', { err: err?.response?.data || err?.message });
    if (!res.headersSent) return res.status(500).json({ ok: false });
  }
};

export default { pivotPaymentCallback };
