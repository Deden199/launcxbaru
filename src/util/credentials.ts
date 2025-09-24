// File: src/util/credentials.ts
import { z } from 'zod'

/** Schema per provider untuk parsing awal dan validasi */
const hilogateCredSchema = z.object({
  merchantId: z.string().min(1),
  env: z.enum(['sandbox', 'production', 'live']).optional().default('sandbox'),
  secretKey: z.string().min(1),
})

const oyCredSchema = z.object({
  baseUrl: z.string().url().optional().default(process.env.OY_BASE_URL || ''),
  username: z.string().min(1),
  apiKey: z.string().min(1),
})

const gidiCredSchema = z.object({
  baseUrl: z.string().url(),
  credentialKey: z.string().min(1),
  merchantId: z.string().optional(),
  subMerchantId: z.string().optional(),
})

const ing1CredSchema = z.object({
  baseUrl: z.string().trim().url(),
  email: z.string().trim().email(),
  password: z.string().min(1),
  productCode: z.string().trim().min(1).optional(),
  callbackUrl: z.string().trim().url().optional(),
  permanentToken: z.string().trim().min(1).optional(),
  merchantId: z.string().trim().min(1).optional(),
  apiVersion: z.string().trim().min(1).optional(),
})

/** Tipe hasil normalisasi per provider (tidak di‐flatten berlebihan) */
export type NormalizedHilogate = z.infer<typeof hilogateCredSchema>
export type NormalizedOy = z.infer<typeof oyCredSchema>
export type NormalizedGidi = z.infer<typeof gidiCredSchema>
export type NormalizedIng1 = z.infer<typeof ing1CredSchema>

export type NormalizedCred =
  | ({ provider: 'hilogate' } & NormalizedHilogate)
  | ({ provider: 'oy' } & NormalizedOy)
  | ({ provider: 'gidi' } & NormalizedGidi)
  | ({ provider: 'ing1' } & NormalizedIng1)
  | ({ provider: string; extra: any })

/** Ambil dan parse raw credential sesuai provider */
export function parseRawCredential(provider: string, input: any): any {
  if (!input || typeof input !== 'object') return {}
  switch (provider) {
    case 'hilogate': {
      // Bisa menerima variasi key jika diperlukan di masa depan
      const { merchantId, merchant_id, env, environment, secretKey, secret_key } = input
      return {
        merchantId: merchantId ?? merchant_id,
        env: env ?? environment,
        secretKey: secretKey ?? secret_key,
      }
    }
    case 'oy': {
      const { username, user, apiKey, api_key, baseUrl, base_url } = input
      return {
        baseUrl: baseUrl ?? base_url,
        username: username ?? user,
        apiKey: apiKey ?? api_key,
      }
    }
    case 'gidi': {
      const {
        baseUrl,
        base_url,
        credentialKey,
        credential_key,
        merchantId,
        merchant_id,
        subMerchantId,
        sub_merchant_id,
      } = input
      return {
        baseUrl: baseUrl ?? base_url,
        credentialKey: credentialKey ?? credential_key,
        merchantId: merchantId ?? merchant_id,
        subMerchantId: subMerchantId ?? sub_merchant_id,
      }
    }
    case 'ing1': {
      const {
        baseUrl,
        base_url,
        email,
        password,
        productCode,
        product_code,
        callbackUrl,
        callback_url,
        return_url,
        permanentToken,
        permanent_token,
        token,
        merchantId,
        merchant_id,
        apiVersion,
        api_version,
        version,
      } = input

      const pickRequired = (...vals: any[]) => {
        for (const val of vals) {
          if (typeof val === 'string') {
            const trimmed = val.trim()
            if (trimmed.length > 0) {
              return trimmed
            }
          }
        }
        return undefined
      }

      const pickOptional = (...vals: any[]) => {
        for (const val of vals) {
          if (typeof val === 'string') {
            const trimmed = val.trim()
            if (trimmed.length > 0) {
              return trimmed
            }
          }
        }
        return undefined
      }

      return {
        baseUrl: pickRequired(baseUrl, base_url),
        email: pickRequired(email),
        password: pickRequired(password),
        productCode: pickOptional(productCode, product_code),
        callbackUrl: pickOptional(callbackUrl, callback_url, return_url),
        permanentToken: pickOptional(permanentToken, permanent_token, token),
        merchantId: pickOptional(merchantId, merchant_id),
        apiVersion: pickOptional(apiVersion, api_version, version),
      }
    }
    default:
      return input
  }
}

/** Validasi & normalisasi sesuai shape yang disimpan / dikonsumsi downstream */
export function normalizeCredentials(provider: string, raw: any): NormalizedCred {
  switch (provider) {
    case 'hilogate': {
      const parsed = hilogateCredSchema.parse(raw)
      return { provider, ...parsed }
    }
    case 'oy': {
      const parsed = oyCredSchema.parse(raw)
      return { provider, ...parsed }
    }
    case 'gidi': {
      const parsed = gidiCredSchema.parse(raw)
      return { provider, ...parsed }
    }
    case 'ing1': {
      const parsed = ing1CredSchema.parse(raw)
      return { provider, ...parsed }
    }
    default:
      return { provider, extra: raw }
  }
}
