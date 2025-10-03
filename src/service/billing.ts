import axios from 'axios'

import logger from '../logger'

export interface BalanceMovementPayload {
  partnerClientId: string
  amount: number
  reference: string
  description?: string
}

const DEFAULT_TIMEOUT = Number(process.env.BILLING_SERVICE_TIMEOUT_MS ?? 15_000)

function resolveBaseUrl() {
  return (process.env.BILLING_SERVICE_URL || '').replace(/\/$/, '')
}

export async function postBalanceMovement(payload: BalanceMovementPayload): Promise<void> {
  const baseUrl = resolveBaseUrl()
  if (!baseUrl) {
    logger.warn('[BillingService] BILLING_SERVICE_URL not configured, skipping movement', payload)
    return
  }

  try {
    await axios.post(
      `${baseUrl}/balance-movements`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.BILLING_SERVICE_API_KEY
            ? { 'x-api-key': process.env.BILLING_SERVICE_API_KEY }
            : {}),
        },
        timeout: DEFAULT_TIMEOUT,
      }
    )
  } catch (err) {
    logger.error('[BillingService] Failed to post balance movement', err)
    throw err
  }
}
