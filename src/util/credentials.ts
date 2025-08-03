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

/** Tipe hasil normalisasi per provider (tidak di‐flatten berlebihan) */
export type NormalizedHilogate = z.infer<typeof hilogateCredSchema>
export type NormalizedOy = z.infer<typeof oyCredSchema>
export type NormalizedGidi = z.infer<typeof gidiCredSchema>

export type NormalizedCred =
  | ({ provider: 'hilogate' } & NormalizedHilogate)
  | ({ provider: 'oy' } & NormalizedOy)
  | ({ provider: 'gidi' } & NormalizedGidi)
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
    default:
      return { provider, extra: raw }
  }
}
