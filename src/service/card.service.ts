import axios from 'axios';
import { config } from '../config';

const baseUrl = config.api.paymentApi?.baseUrl || '';
const auth = {
  username: config.api.paymentApi?.apiKey || '',
  password: config.api.paymentApi?.apiSecret || '',
};

const buildAuth = () =>
  auth.username || auth.password ? { auth } : undefined;

const handleError = (err: any) => {
  const status = err.response?.status || 500;
  const message = err.response?.data?.message || err.message || 'Provider error';
  const error = new Error(message);
  (error as any).status = status;
  throw error;
};

/**
 * Sesuai dok:
 * - mode: "API"
 * - paymentType: "SINGLE"
 * - paymentMethod.type: "CARD"
 * - autoConfirm: false
 * - redirectUrl: { successReturnUrl, failureReturnUrl, expirationReturnUrl }
 * - amount: { value, currency }
 * - gunakan "orderInformation" (mapping dari argumen `order` agar backward-compatible)
 *
 * Catatan: statementDescriptor, expiryAt, metadata opsional—bisa ditambahkan jika tersedia.
 */
export const createCardSession = async (
  amount: number,
  currency: string,
  customer: any,
  order: any,
  opts?: {
    statementDescriptor?: string;
    expiryAt?: string; // ISO string, contoh: "2025-12-30T23:59:00Z"
    metadata?: Record<string, any>;
    paymentType?: 'SINGLE' | 'RECURRING';
  }
) => {
  try {
    const redirectBase = config.api.frontendBaseUrl;
    if (!redirectBase) {
      throw new Error('FRONTEND_BASE_URL environment variable is required');
    }
    const base = redirectBase.replace(/\/$/, '');

    const payload: any = {
      mode: 'API',
      paymentType: opts?.paymentType ?? 'SINGLE',
      paymentMethod: { type: 'CARD' },
      autoConfirm: false,
      redirectUrl: {
        successReturnUrl: `${base}/payment-success`,
        failureReturnUrl: `${base}/payment-failure`,
        expirationReturnUrl: `${base}/payment-expired`,
      },
      amount: {
        value: amount,
        currency,
      },
      customer,
      // Dokumen menamai "orderInformation"; kita map dari argumen lama `order`
      orderInformation: order,
    };

    if (opts?.statementDescriptor) {
      payload.statementDescriptor = opts.statementDescriptor;
    }
    if (opts?.expiryAt) {
      payload.expiryAt = opts.expiryAt;
    }
    if (opts?.metadata) {
      payload.metadata = opts.metadata;
    }

    const resp = await axios.post(
      `${baseUrl}/v2/payments`,
      payload,
      buildAuth()
    );
    return resp.data;
  } catch (err: any) {
    handleError(err);
  }
};

/**
 * Sesuai dok:
 * - paymentMethod: { type: "CARD", card: { encryptedCard } }
 * - paymentMethodOptions: card.captureMethod / threeDsMethod / processingConfig (opsional)
 *
 * Kita set default ringan untuk meniru contoh dok jika caller tidak mengirim:
 * captureMethod: 'automatic', threeDsMethod: 'CHALLENGE'
 */
export const confirmCardSession = async (
  id: string,
  encryptedCard: string,
  paymentMethodOptions?: {
    card?: {
      captureMethod?: 'automatic' | 'manual';
      threeDsMethod?: 'CHALLENGE' | 'Frictionless' | 'AUTO' | 'CHALLENGE_ONLY';
      processingConfig?: {
        bankMerchantId?: string | null;
        merchantIdTag?: string | null;
      };
    };
  }
) => {
  try {
    const mergedOptions = {
      card: {
        captureMethod: paymentMethodOptions?.card?.captureMethod ?? 'automatic',
        threeDsMethod: paymentMethodOptions?.card?.threeDsMethod ?? 'CHALLENGE',
        processingConfig: paymentMethodOptions?.card?.processingConfig ?? {
          bankMerchantId: null,
          merchantIdTag: null,
        },
      },
    };

    const resp = await axios.post(
      `${baseUrl}/v2/payments/${id}/confirm`,
      {
        paymentMethod: { type: 'CARD', card: { encryptedCard } },
        paymentMethodOptions: mergedOptions,
      },
      buildAuth()
    );
    return resp.data;
  } catch (err: any) {
    handleError(err);
  }
};

export const getPayment = async (id: string) => {
  try {
    const resp = await axios.get(
      `${baseUrl}/v2/payments/${id}`,
      buildAuth()
    );
    return resp.data;
  } catch (err: any) {
    handleError(err);
  }
};

export default { createCardSession, confirmCardSession, getPayment };
