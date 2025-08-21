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

export const createCardSession = async () => {
  try {
    const redirectBase =
      process.env.CARD_REDIRECT_BASE_URL || config.api.baseUrl || '';
    const base = redirectBase.replace(/\/$/, '');
    const resp = await axios.post(
      `${baseUrl}/v2/payments`,
      {
        mode: 'API',
        paymentMethod: { type: 'CARD' },
        autoConfirm: false,
        redirectUrl: {
          success: `${base}/payment-success`,
          failure: `${base}/payment-failure`,
          expired: `${base}/payment-expired`,
        },
      },
      buildAuth()
    );
    return resp.data;
  } catch (err: any) {
    handleError(err);
  }
};

export const confirmCardSession = async (
  id: string,
  encryptedCard: string,
  paymentMethodOptions?: any
) => {
  try {
    const resp = await axios.post(
      `${baseUrl}/v2/payments/${id}/confirm`,
      {
        paymentMethod: { type: 'CARD', encryptedCard },
        paymentMethodOptions,
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
