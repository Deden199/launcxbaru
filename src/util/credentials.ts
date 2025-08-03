// src/util/credentials.ts
import { z } from 'zod'

/** Schema per provider */
export const hilogateCredSchema = z.object({
  merchantId: z.string(),
  env: z.enum(['sandbox', 'production', 'live']).optional().default('sandbox'),
  secretKey: z.string(),
})

export const oyCredSchema = z.object({
  username: z.string(),
  apiKey: z.string(),
})

export const gidiCredSchema = z.object({
  baseUrl: z.string().url(),
  clientId: z.string(),
  clientSecret: z.string(),
  credentialKey: z.string(),
  merchantId: z.string().optional(),
})

export type NormalizedCred = {
  provider: 'hilogate' | 'oy' | 'gidi' | string
  merchantId?: string        // Hilogate: merchantId, OY: username, Gidi: optional merchantId
  secretKey?: string        // Hilogate: secretKey, OY: apiKey
  env?: 'sandbox' | 'production' | 'live'
  baseUrl?: string          // Gidi override
  extra?: Record<string, any> // untuk tambahan spesifik (clientSecret, credentialKey, dsb)
}

/** Kembalikan parsed credential sesuai provider (validasi) */
export function parseRawCredential(provider: string, raw: any): any {
  switch (provider) {
    case 'hilogate':
      return hilogateCredSchema.parse(raw)
    case 'oy':
      return oyCredSchema.parse(raw)
    case 'gidi':
      return gidiCredSchema.parse(raw)
    default:
      return raw
  }
}

/** Normalisasi jadi bentuk internal konsisten */
export function normalizeCredentials(provider: string, parsed: any): NormalizedCred {
  switch (provider) {
    case 'hilogate': {
      const p = parsed as z.infer<typeof hilogateCredSchema>
      return {
        provider,
        merchantId: p.merchantId,
        secretKey: p.secretKey,
        env: p.env,
      }
    }
    case 'oy': {
      const p = parsed as z.infer<typeof oyCredSchema>
      return {
        provider,
        merchantId: p.username,
        secretKey: p.apiKey,
      }
    }
    case 'gidi': {
      const p = parsed as z.infer<typeof gidiCredSchema>
      return {
        provider,
        baseUrl: p.baseUrl,
        merchantId: p.merchantId, // optional
        extra: {
          clientId: p.clientId,
          clientSecret: p.clientSecret,
          credentialKey: p.credentialKey,
        },
      }
    }
    default:
      return { provider, extra: parsed }
  }
}
