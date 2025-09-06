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
          cursor, limit = 20 } = req.query

  const where: any = {}
  if (ref_id)     where.id         = String(ref_id)
  if (merchantId) where.merchantId = merchantId
  if (status)     where.status     = String(status)
  if (date_from || date_to) {
    where.createdAt = {}
    if (date_from) where.createdAt.gte = new Date(String(date_from))
    if (date_to)   where.createdAt.lte = new Date(String(date_to))
  }

  const take = Number(limit)
  const cursorId = cursor ? String(cursor) : undefined

  const query: any = {
    where,
    take: take + 1,
    orderBy: { createdAt: 'desc' },
  }
  if (cursorId) {
    query.cursor = { id: cursorId }
    query.skip = 1
  }

  const [rows, countResult] = await Promise.all([
    prisma.transaction_request.findMany(query),
    cursorId
      ? Promise.resolve(undefined)
      : prisma.transaction_request.aggregate({ _count: true, where })
  ])

  let nextCursor: string | undefined
  if (rows.length > take) {
    const nextItem = rows.pop()!
    nextCursor = nextItem.id
  }

  const total = countResult?._count

  res.json({ data: rows, nextCursor, total })
}

/* ─────────── 2. Paksa-sync Hilogate ─────────── */
export async function syncTransaction(req: AuthRequest, res: Response) {
  try {
    // 1) Cari transaksi untuk dapatkan merchantId
    const tx = await prisma.transaction_request.findUnique({
      where: { id: req.params.ref_id },
      select: { merchantId: true },
    });
    if (!tx) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // 2) Panggil service dengan refId + merchantId
    const updated = await syncWithHilogate(
      req.params.ref_id,
      tx.merchantId
    );

    return res.json({ success: true, updated });
  } catch (err: any) {
    console.error('[syncTransaction] error:', err);
    return res.status(500).json({ message: err.message });
  }
}


/* ─────────── 3. Buat transaksi dummy ─────────── */
export async function createTransaction (req: AuthRequest, res: Response) {
  try {
    const merchantId = req.userId!            // partner-client yg login
    const { buyerId, amount, playerId: bodyPid } = req.body
    const pid = String(bodyPid ?? 0)
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
