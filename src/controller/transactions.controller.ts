import { Response }          from 'express'
import { prisma }            from '../core/prisma'
import { syncWithHilogate }  from '../service/hilogate.service'
import { AuthRequest }       from '../middleware/auth'
import { $Enums }            from '@prisma/client'   // enum helper

/* ─────────── 1. List transaksi ─────────── */
export async function listTransactions (req: AuthRequest, res: Response) {
  const merchantId =
    req.userRole === 'ADMIN'
      ? (req.query.merchantId as string | undefined)
      : req.userId!

  const { ref_id, status, date_from, date_to,
          page = 1, limit = 20 } = req.query

  const where: any = {}
  if (ref_id)     where.id         = { contains: String(ref_id) }
  if (merchantId) where.merchantId = merchantId
  if (status)     where.status     = String(status)
  if (date_from || date_to) {
    where.createdAt = {}
    if (date_from) where.createdAt.gte = new Date(String(date_from))
    if (date_to)   where.createdAt.lte = new Date(String(date_to))
  }

  const skip  = (Number(page) - 1) * Number(limit)
  const take  = Number(limit)

  const [data, total] = await Promise.all([
    prisma.transaction_request.findMany({ where, skip, take,
      orderBy: { createdAt: 'desc' } }),
    prisma.transaction_request.count({ where }),
  ])

  res.json({ data, total })
}

/* ─────────── 2. Paksa-sync Hilogate ─────────── */
export async function syncTransaction (req: AuthRequest, res: Response) {
  try {
    const updated = await syncWithHilogate(req.params.ref_id)
    res.json({ success: true, updated })
  } catch (err: any) {
    res.status(500).json({ message: err.message })
  }
}

/* ─────────── 3. Buat transaksi dummy ─────────── */
export async function createTransaction (req: AuthRequest, res: Response) {
  try {
    const merchantId = req.userId!            // partner-client yg login
    const { buyerId, amount, playerId: bodyPid } = req.body
    const pid = bodyPid ?? req.userId
const trx = await prisma.transaction_request.create({
  data: {
    merchantId,              // FK merchant
    subMerchantId: '',       // kosong dulu (jika tidak pakai sub-merchant)
    buyerId : String(buyerId),
    amount  : Number(amount),
    status  : 'PENDING',
    playerId:         pid,             // ← tambahkan

  },
})


    // TODO: generate QR & update trx

    res.status(201).json(trx)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
