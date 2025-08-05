import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import logger from '../logger';
import { config } from '../config';

/**
 * Perform HTTP POST with retry and exponential backoff.
 * @param url Endpoint URL
 * @param data Payload
 * @param options Axios request options
 * @param attempts Number of attempts (default from config)
 * @param intervalMs Initial delay in milliseconds (default from config)
 */
export async function postWithRetry<T = any>(
  url: string,
  data?: any,
  options: AxiosRequestConfig = {},
  attempts: number = config.api.httpRetry.attempts,
  intervalMs: number = config.api.httpRetry.intervalMs
): Promise<AxiosResponse<T>> {
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await axios.post<T>(url, data, options);
      if (attempt > 1) {
        logger.info(`[postWithRetry] success on attempt ${attempt}`);
      }
      return resp;
    } catch (err: any) {
      lastErr = err;
            const status = err.response?.status;
      if (status >= 400 && status < 500) {
        logger.error(
          `[postWithRetry] client error ${status}: ${JSON.stringify(err.response?.data)}`
        );
        throw err;
      }
      if (attempt >= attempts) {
        logger.error(
          `[postWithRetry] failed after ${attempts} attempts: ${err.message}`
        );
        throw err;
      }
      const delay = intervalMs * Math.pow(2, attempt - 1);
      logger.warn(
        `[postWithRetry] attempt ${attempt} failed, retrying in ${delay}ms`
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastErr;
}