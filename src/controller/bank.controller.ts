import { Request, Response } from 'express'
import hilogateClient from '../service/hilogateClient'

/**
 * GET /api/v1/banks
 * Mengembalikan daftar bank dari Hilogate
 */
export async function getBanks(req: Request, res: Response) {
  try {
    // Panggil API Hilogate untuk daftar bank
    const resp = await hilogateClient.getBankCodes()
    // resp adalah wrapper: { code, data: Array<{name, code}>, message, status }
    return res.json({ banks: resp })
  } catch (err: any) {
    console.error('[getBanks] Hilogate API error:', err)
    return res.status(500).json({ error: 'Gagal mengambil daftar bank dari Hilogate' })
  }
}
