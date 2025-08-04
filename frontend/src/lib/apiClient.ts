// File: frontend/src/lib/apiClient.ts
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

interface ErrorPayload {
  code?: string;
  message?: string;
}

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '', // contoh: http://localhost:5001/api/v1
  withCredentials: true, // kalau refresh token di cookie httpOnly
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// state untuk refresh token flow
let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];
let hasRedirected = false;

function processQueue(token: string | null) {
  refreshQueue.forEach(cb => cb(token));
  refreshQueue = [];
}

async function attemptTokenRefresh(): Promise<string> {
  // asumsi endpoint refresh ada dan mengembalikan { accessToken: string }
  const resp = await axios.post(
    `${process.env.NEXT_PUBLIC_API_URL || ''}/auth/refresh-client`,
    {},
    {
      withCredentials: true, // jika refresh token di cookie
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000,
    }
  );
  const newToken = resp.data?.accessToken;
  if (!newToken) throw new Error('Refresh gagal: tidak ada token baru');
  // simpan token baru
  if (typeof window !== 'undefined') {
    localStorage.setItem('clientToken', newToken);
  }
  return newToken;
}

// Request interceptor: pasang Authorization jika ada
apiClient.interceptors.request.use(
  config => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('clientToken');
      if (token) {
        config.headers = config.headers || {};
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return config;
  },
  err => Promise.reject(err)
);

// Response interceptor: handle expired token / invalid token dengan refresh
apiClient.interceptors.response.use(
  response => response,
  async (error: AxiosError) => {
    const resp = error.response;
    const originalConfig = error.config as AxiosRequestConfig & { _retry?: boolean };

    // kalau ga ada response (network error), langsung reject
    if (!resp) return Promise.reject(error);

    // extract structured error if backend kirim
    const errData = (resp.data as any)?.error as ErrorPayload | undefined;
    const errorCode = errData?.code;
    const errorMessage = errData?.message || (resp.data as any)?.message || '';

    const isAuthError =
      resp.status === 401 &&
      (errorCode === 'TOKEN_EXPIRED' ||
        errorCode === 'INVALID_TOKEN' ||
        /token/i.test(errorMessage) &&
          (/expired/i.test(errorMessage) || /invalid/i.test(errorMessage)));

    // handle token expired / invalid dengan refresh sekali
    if (isAuthError) {
      if (originalConfig && !originalConfig._retry) {
        // tunggu refresh jika sudah berjalan
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            refreshQueue.push(token => {
              if (token) {
                if (originalConfig.headers) {
                  originalConfig.headers['Authorization'] = `Bearer ${token}`;
                }
                originalConfig._retry = true;
                resolve(apiClient.request(originalConfig));
              } else {
                reject(error);
              }
            });
          });
        }

        originalConfig._retry = true;
        isRefreshing = true;

        try {
          const newToken = await attemptTokenRefresh();
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
          processQueue(newToken);
          if (originalConfig.headers) {
            originalConfig.headers['Authorization'] = `Bearer ${newToken}`;
          }
          return apiClient.request(originalConfig);
        } catch (refreshErr) {
          processQueue(null);
          // gagal refresh: clear dan redirect sekali
          if (typeof window !== 'undefined') {
            localStorage.removeItem('clientToken');
            if (!hasRedirected) {
              hasRedirected = true;
              window.location.href = '/client/login';
            }
          }
          return Promise.reject(refreshErr);
        } finally {
          isRefreshing = false;
        }
      }
    }

    // kasus 401 lain yang bukan token-expired/invalid: jangan logout, terus return ke caller
    if (resp.status === 401 && ['INVALID_TOKEN_SUBJECT', 'CLIENT_USER_NOT_FOUND', 'PARTNER_CLIENT_NOT_FOUND'].includes(errorCode || '')) {
      return Promise.reject(error);
    }

    // semua error lain: reject normal
    return Promise.reject(error);
  }
);

export default apiClient;
