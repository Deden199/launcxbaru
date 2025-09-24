import { Request, Response } from 'express'
import { prisma } from '../core/prisma'
import { retryDisbursement } from '../service/hilogate.service'
import { ClientAuthRequest } from '../middleware/clientAuth'
import { ApiKeyRequest } from '../middleware/apiKeyAuth'
import { HilogateClient,HilogateConfig } from '../service/hilogateClient'
import { GidiClient, GidiDisbursementConfig, GidiError } from '../service/gidiClient'
import { Ing1Client, Ing1Config } from '../service/ing1Client'
import crypto from 'crypto'
import { config } from '../config'
import logger from '../logger'
import { DisbursementStatus } from '@prisma/client'
import { getActiveProviders } from '../service/provider';
import {OyClient,OyConfig}          from '../service/oyClient'    // sesuaikan path
import { authenticator } from 'otplib'
import { parseDateSafely } from '../util/time'
import { mapIng1Status, parseIng1Date, parseIng1Number } from '../service/ing1Status'

const mapIng1ToDisbursement = (
  rc?: number | null,
  statusText?: string | null
): DisbursementStatus => {
  const normalized = mapIng1Status(rc ?? null, statusText ?? null)
  if (normalized === 'PAID') return DisbursementStatus.COMPLETED
  if (normalized === 'PENDING') return DisbursementStatus.PENDING
  return DisbursementStatus.FAILED
}



export const listSubMerchants = async (req: ClientAuthRequest, res: Response) => {
  const clientUserId = req.clientUserId!
  // 1) Ambil partnerClientId + defaultProvider dari user
  const userWithDp = await prisma.clientUser.findUnique({
    where: { id: clientUserId },
    select: {
      partnerClientId: true,
      partnerClient: {
        select: { defaultProvider: true }
        
      }
    }
  })
  if (!userWithDp) return res.status(404).json({ error: 'User tidak ditemukan' })

  const { partnerClientId } = userWithDp
  const defaultProvider = userWithDp.partnerClient.defaultProvider
  if (!defaultProvider) return res.status(400).json({ error: 'defaultProvider tidak diset' })
  // Optional query.clientId untuk filter child
  const { clientId: qClientId } = req.query
  const clientIds = typeof qClientId === 'string' && qClientId !== 'all'
    ? [qClientId]
    : [partnerClientId, ...(req.childrenIds ?? [])]

  // 2) Ambil semua sub_merchant dengan provider matching defaultProvider
  const subs = await prisma.sub_merchant.findMany({
    where: { provider: defaultProvider },
    select: { id: true, name: true, provider: true }
  })

  // 3) Hitung balance tiap sub-merchant dari Order, bukan transaction_request
  const result = await Promise.all(subs.map(async s => {
    // settled in dari Order.settlementTime
    const inAgg = await prisma.order.aggregate({
      _sum: { settlementAmount: true },
      where: {
        subMerchantId:  s.id,
        partnerClientId: { in: clientIds },
        settlementTime: { not: null }
      }
    })
    const totalIn = inAgg._sum.settlementAmount ?? 0

    // pending/completed out dari WithdrawRequest
    const outAgg = await prisma.withdrawRequest.aggregate({
      _sum: { amount: true },
      where: {
        subMerchantId: s.id,
        partnerClientId: { in: clientIds },

        status:        { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
      }
    })
    const totalOut = outAgg._sum.amount ?? 0

    return {
      id:       s.id,
            name:     s.name,

      provider: s.provider,
      balance:  totalIn - totalOut
    }
  }))

  return res.json(result)
}

export async function listWithdrawals(req: ClientAuthRequest, res: Response) {
  // 1) Ambil partnerClientId + daftarnya children
  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    select: {
      partnerClientId: true,
      partnerClient: {
        select: {
          children: { select: { id: true } }
        }
      }
    }
  });
  if (!user) {
    return res.status(404).json({ error: 'User tidak ditemukan' });
  }

  const parentId = user.partnerClientId;
  const childIds = user.partnerClient?.children.map(c => c.id) ?? [];

  // 2) Baca query.clientId (optional) untuk override single-child
  const {
    clientId: qClientId,
    status,
    date_from,
    date_to,
    ref,
    page = '1',
    limit = '20',
  } = req.query;
  const fromDate = parseDateSafely(date_from);
  const toDate   = parseDateSafely(date_to);
  let clientIds: string[];
  if (typeof qClientId === 'string' && qClientId !== 'all') {
    // child-only view
    clientIds = [qClientId];
  } else {
    // parent view: include parent + semua children
    clientIds = [parentId, ...childIds];
  }

  // 3) Build filter
  const where: any = {
    partnerClientId: { in: clientIds }
  };
  if (status) where.status = status as string;
  if (ref)    where.refId = { contains: ref as string, mode: 'insensitive' };
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate)   where.createdAt.lte = toDate;
  }

  // 4) Pagination
  const pageNum  = Math.max(1, parseInt(page as string, 10));
  const pageSize = Math.min(100, parseInt(limit as string, 10));

  // 5) Query
  const [rows, total] = await Promise.all([
    prisma.withdrawRequest.findMany({
      where,
      skip:  (pageNum - 1) * pageSize,
      take:  pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        refId:         true,
        bankName:      true,
       accountName:     true,   // ← tambahkan ini

        accountNumber: true,
        amount:        true,
        netAmount:     true,
        pgFee:         true,
        withdrawFeePercent: true,
        withdrawFeeFlat:    true,
        status:        true,
        createdAt:     true,
        completedAt:   true,
        subMerchant: { select: { name: true, provider: true } },

      },
    }),
    prisma.withdrawRequest.count({ where }),
  ]);

  // 6) Format dan kirim
  const data = rows.map(w => ({
    refId:         w.refId,
    bankName:      w.bankName,
   accountName:   w.accountName,  // ← dan ini

    accountNumber: w.accountNumber,
    amount:        w.amount,
        netAmount:     w.netAmount,
            pgFee:         w.pgFee ?? null,

    withdrawFeePercent: w.withdrawFeePercent,
    withdrawFeeFlat:    w.withdrawFeeFlat,
    status:        w.status,
    createdAt:     w.createdAt.toISOString(),
    completedAt:   w.completedAt?.toISOString() ?? null,
    wallet:        w.subMerchant?.name ?? w.subMerchant?.provider ?? null,

  }));

  return res.json({ data, total });
}

export async function listWithdrawalsS2S(req: ApiKeyRequest, res: Response) {
  const parentId = req.clientId!
  const childIds = req.childrenIds ?? []

  const {
    clientId: qClientId,
    status,
    date_from,
    date_to,
    ref,
    page = '1',
    limit = '20',
  } = req.query
  const fromDate = parseDateSafely(date_from)
  const toDate = parseDateSafely(date_to)
  let clientIds: string[]
  if (typeof qClientId === 'string' && qClientId !== 'all') {
    clientIds = [qClientId]
  } else {
    clientIds = [parentId, ...childIds]
  }

  const where: any = {
    partnerClientId: { in: clientIds },
  }
  if (status) where.status = status as string
  if (ref) where.refId = { contains: ref as string, mode: 'insensitive' }
  if (fromDate || toDate) {
    where.createdAt = {}
    if (fromDate) where.createdAt.gte = fromDate
    if (toDate) where.createdAt.lte = toDate
  }

  const pageNum = Math.max(1, parseInt(page as string, 10))
  const pageSize = Math.min(100, parseInt(limit as string, 10))
  const [rows, total] = await Promise.all([
    prisma.withdrawRequest.findMany({
      where,
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        refId: true,
        bankName: true,
        accountName: true,
        accountNumber: true,
        amount: true,
        netAmount: true,
        pgFee: true,
        withdrawFeePercent: true,
        withdrawFeeFlat: true,
        status: true,
        createdAt: true,
        completedAt: true,
        subMerchant: { select: { name: true, provider: true } },
      },
    }),
    prisma.withdrawRequest.count({ where }),
  ])

  const data = rows.map(w => ({
    refId: w.refId,
    bankName: w.bankName,
    accountName: w.accountName,
    accountNumber: w.accountNumber,
    amount: w.amount,
    netAmount: w.netAmount,
    pgFee: w.pgFee ?? null,
    withdrawFeePercent: w.withdrawFeePercent,
    withdrawFeeFlat: w.withdrawFeeFlat,
    status: w.status,
    createdAt: w.createdAt.toISOString(),
    completedAt: w.completedAt?.toISOString() ?? null,
    wallet: w.subMerchant?.name ?? w.subMerchant?.provider ?? null,
  }))

  return res.json({ data, total })
}

// POST /api/v1/withdrawals/:id/retry
export async function retryWithdrawal(req: Request, res: Response) {
  // clientId di-attach oleh middleware ClientAuthRequest, tapi di sini kita pakai req.client.id
  const clientId = (req as any).client.id as string;
  const { id }   = req.params;

  // 1) Ownership check
  const wr = await prisma.withdrawRequest.findUnique({
    where: { refId: id },
    select: { refId: true, status: true, partnerClientId: true }
  });
  if (!wr || wr.partnerClientId !== clientId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // 2) Status guard
  if (['SUCCESS', 'PROCESSING'].includes(wr.status)) {
    return res
      .status(400)
      .json({ error: `Tidak dapat retry untuk status ${wr.status}` });
  }

  // 3) Retry process with merchantId
  try {
    const result = await retryDisbursement(wr.refId, wr.partnerClientId);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('Retry withdrawal error:', err);
    return res
      .status(500)
      .json({ error: 'Gagal melakukan retry. Silakan coba lagi nanti.' });
  }
}
async function retry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastError: any
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastError = e
      if (e.message?.includes('write conflict') || e.code === 'P2034') {
        await new Promise(r => setTimeout(r, 50 * (i + 1)))
        continue
      }
      throw e
    }
  }
  throw lastError
}

// Query all pending Gidi withdrawals and refresh their status via GIDI API
export async function queryPendingGidiWithdrawals(req: Request, res: Response) {
  try {
    const pendings = await prisma.withdrawRequest.findMany({
      where: { sourceProvider: 'gidi', status: DisbursementStatus.PENDING },
      select: {
        refId: true,
        partnerClientId: true,
        amount: true,
        subMerchant: { select: { credentials: true } },
      },
    })

    const results: { refId: string; status: DisbursementStatus }[] = []

    for (const w of pendings) {
      try {
        const cfg = w.subMerchant.credentials as unknown as GidiDisbursementConfig
        const client = new GidiClient(cfg)
        const resp = await client.queryTransfer(`${w.refId}-r`, w.refId)
        const st = String(resp.statusTransfer || '').toLowerCase()
        const newStatus =
          st === 'success'
            ? DisbursementStatus.COMPLETED
            : st === 'failed'
              ? DisbursementStatus.FAILED
              : DisbursementStatus.PENDING

        if (newStatus !== DisbursementStatus.PENDING) {
          await prisma.withdrawRequest.update({
            where: { refId: w.refId },
            data: { status: newStatus },
          })
          if (newStatus === DisbursementStatus.FAILED) {
            await prisma.partnerClient.update({
              where: { id: w.partnerClientId },
              data: { balance: { increment: w.amount } },
            })
          }
        }

        results.push({ refId: w.refId, status: newStatus })
      } catch (err) {
        logger.error('[queryPendingGidiWithdrawals] error', { refId: w.refId, err })
      }
    }

    return res.json({ processed: results.length, results })
  } catch (err: any) {
    logger.error('[queryPendingGidiWithdrawals] fatal', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function queryPendingIng1Withdrawals(req: Request, res: Response) {
  try {
    const pendings = await prisma.withdrawRequest.findMany({
      where: { sourceProvider: 'ing1', status: DisbursementStatus.PENDING },
      select: {
        refId: true,
        partnerClientId: true,
        amount: true,
        paymentGatewayId: true,
        subMerchant: { select: { credentials: true } },
      },
    })

    const results: { refId: string; status: DisbursementStatus }[] = []

    for (const w of pendings) {
      try {
        const rawCfg = w.subMerchant?.credentials as unknown as Ing1Config
        const cfg: Ing1Config = {
          baseUrl: rawCfg.baseUrl,
          email: rawCfg.email,
          password: rawCfg.password,
          productCode: rawCfg.productCode,
          callbackUrl: rawCfg.callbackUrl,
          permanentToken: rawCfg.permanentToken,
          merchantId: rawCfg.merchantId,
          apiVersion: rawCfg.apiVersion,
        }

        const client = new Ing1Client(cfg)
        const history = await client.listCashoutHistory({
          reff: w.paymentGatewayId ?? undefined,
          clientReff: w.refId,
        })

        const match = history.histories.find((item) => {
          if (w.paymentGatewayId && item.reff) {
            return item.reff === w.paymentGatewayId
          }
          return item.clientReff === w.refId
        })

        const statusCandidate = match?.status ?? (history.raw?.status as string | undefined)
        const newStatus = mapIng1ToDisbursement(history.rc, statusCandidate ?? null)

        if (newStatus !== DisbursementStatus.PENDING) {
          const updateData: any = {
            status: newStatus,
          }

          if (match?.reff) {
            updateData.paymentGatewayId = match.reff
          }

          if (match?.paidAt) {
            const paidAt = parseIng1Date(match.paidAt)
            if (paidAt) updateData.completedAt = paidAt
          }

          const feeCandidate =
            typeof match?.fee === 'number' ? match.fee : parseIng1Number(match?.fee ?? null)
          if (feeCandidate != null) {
            updateData.pgFee = feeCandidate
          }

          await prisma.withdrawRequest.update({
            where: { refId: w.refId },
            data: updateData,
          })

          if (newStatus === DisbursementStatus.FAILED) {
            await prisma.partnerClient.update({
              where: { id: w.partnerClientId },
              data: { balance: { increment: w.amount } },
            })
          }
        }

        results.push({ refId: w.refId, status: newStatus })
      } catch (err) {
        logger.error('[queryPendingIng1Withdrawals] error', { refId: w.refId, err })
      }
    }

    return res.json({ processed: results.length, results })
  } catch (err: any) {
    logger.error('[queryPendingIng1Withdrawals] fatal', err)
    return res.status(500).json({ error: err.message })
  }
}

export const withdrawalCallback = async (req: Request, res: Response) => {
  try {
    // 1) Ambil & parse raw body
    // @ts-ignore
    const raw = (req.rawBody as Buffer).toString('utf8')
    const full = JSON.parse(raw) as any

    // 2) Verifikasi signature
    const gotSig = (req.header('X-Signature') || '').trim()
    if (full.merchant_signature && gotSig !== full.merchant_signature) {
      return res.status(400).json({ error: 'Invalid signature' })
    }

    // 3) Ambil payload
    const data = full.data ?? full

    // Deteksi format OY atau Hilogate
    const isOy =
      typeof data.status === 'object' &&
      data.status !== null &&
      'code' in data.status

    const refId = isOy ? data.partner_trx_id : data.ref_id
    if (!refId) {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    // 4) Fetch withdrawal record
    const wr = await prisma.withdrawRequest.findUnique({
      where: { refId },
      select: { amount: true, partnerClientId: true, status: true }
    })
    let adminW: { status: DisbursementStatus } | null = null
    let isAdmin = false
    if (!wr) {
      adminW = await prisma.adminWithdraw.findUnique({
        where: { refId },
        select: { status: true }
      })
      if (!adminW) return res.status(404).send('Not found')
      isAdmin = true
    }
    const oldStatus = wr ? wr.status : adminW!.status
    // 5) Tentukan newStatus + completedAt
    let newStatus: DisbursementStatus
    let completedAt: Date | undefined

    if (isOy) {
      const code = String(data.status.code)
      newStatus =
        code === '000'
          ? DisbursementStatus.COMPLETED
          : code === '300'
            ? DisbursementStatus.FAILED
            : DisbursementStatus.PENDING
      completedAt = parseDateSafely(data.last_updated_date)

    } else {
      const up = String(data.status).toUpperCase()
      newStatus =
        up === 'COMPLETED' || up === 'SUCCESS'
          ? DisbursementStatus.COMPLETED
          : up === 'FAILED' || up === 'ERROR'
            ? DisbursementStatus.FAILED
            : DisbursementStatus.PENDING
      completedAt = parseDateSafely(data.completed_at)
    }

        // 6) Idempotent update +retry
        
    const updateData: any = { status: newStatus }
    const feeRaw =
      typeof data.total_fee === 'number'
        ? data.total_fee
        : typeof data.fee === 'number'
          ? data.fee
          : typeof data.transfer_fee === 'number'
            ? data.transfer_fee
            : typeof data.admin_fee?.total_fee === 'number'
              ? data.admin_fee.total_fee
              : null
    if (feeRaw != null) {
      updateData.pgFee = feeRaw
    }
        if (data.trx_id || data.trxId) {
      updateData.pgRefId = data.trx_id || data.trxId
    }
    if (completedAt) {
      updateData.completedAt = completedAt
    } else if (data.last_updated_date) {
      logger.warn(`Failed to parse last_updated_date: ${data.last_updated_date}`)
    }

    const { count } = await retry(() =>
      (isAdmin
        ? prisma.adminWithdraw.updateMany({
            where: {
              refId,
              status: { in: [DisbursementStatus.PENDING, DisbursementStatus.FAILED] },
            },
            data: updateData,
          })
        : prisma.withdrawRequest.updateMany({
            where: {
              refId,
              status: { in: [DisbursementStatus.PENDING, DisbursementStatus.FAILED] },
            },
            data: updateData,

          }))
    )

    // 7) Balance adjustments based on status transition
    if (!isAdmin && count > 0 && oldStatus !== newStatus) {
      if (oldStatus === DisbursementStatus.FAILED && newStatus === DisbursementStatus.COMPLETED) {
        await retry(() =>
          prisma.partnerClient.update({
            where: { id: wr!.partnerClientId },
            data: { balance: { decrement: wr!.amount } },
          })
        )
      } else if (oldStatus === DisbursementStatus.PENDING && newStatus === DisbursementStatus.FAILED) {
        await retry(() =>
          prisma.partnerClient.update({
            where: { id: wr!.partnerClientId },
            data: { balance: { increment: wr!.amount } },
          })
        )
      }
    }

    return res.status(200).json({ message: 'OK' })
  } catch (err: any) {
    console.error('[withdrawalCallback] error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export const ing1WithdrawalCallback = async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>
    const rcStr = query.rc ?? query.RC
    const statusText = query.status ?? query.STATUS
    const billerReff = query.reff ?? query.reff_id ?? query.biller_reff
    const clientRef =
      query.client_reff ?? query.clientReff ?? query.client_ref ?? query.ref_id ?? query.refId

    if (!clientRef) {
      return res.status(400).json({ error: 'Missing client reference' })
    }

    const wr = await prisma.withdrawRequest.findUnique({
      where: { refId: clientRef },
      select: { status: true, partnerClientId: true, amount: true },
    })

    if (!wr) {
      return res.status(404).json({ error: 'Withdrawal not found' })
    }

    const rc = rcStr != null ? Number(rcStr) : null
    const newStatus = mapIng1ToDisbursement(rc, statusText ?? null)

    const updateData: any = {
      status: newStatus,
    }

    if (billerReff) {
      updateData.paymentGatewayId = billerReff
    }

    const feeRaw =
      parseIng1Number(query.fee ?? query.total_fee ?? query.admin_fee ?? query.pg_fee) ?? null
    if (feeRaw != null) {
      updateData.pgFee = feeRaw
    }

    const completedAt =
      parseIng1Date(
        query.completed_at ??
          query.settlement_time ??
          query.settlementTime ??
          query.paid_at ??
          query.paidAt ??
          null
      ) ?? null
    if (completedAt) {
      updateData.completedAt = completedAt
    }

    const result = await prisma.withdrawRequest.updateMany({
      where: {
        refId: clientRef,
        status: { in: [DisbursementStatus.PENDING, DisbursementStatus.FAILED] },
      },
      data: updateData,
    })

    if (result.count === 0) {
      return res.json({ ok: true, updated: false })
    }

    if (newStatus === DisbursementStatus.FAILED) {
      await prisma.partnerClient.update({
        where: { id: wr.partnerClientId },
        data: { balance: { increment: wr.amount } },
      })
    } else if (wr.status === DisbursementStatus.FAILED && newStatus === DisbursementStatus.COMPLETED) {
      await prisma.partnerClient.update({
        where: { id: wr.partnerClientId },
        data: { balance: { decrement: wr.amount } },
      })
    }

    return res.json({ ok: true, updated: true })
  } catch (err: any) {
    logger.error('[ing1WithdrawalCallback] error', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
export async function validateAccount(req: ClientAuthRequest, res: Response) {
  const {
    account_number,
    bank_code,
    sourceProvider = 'hilogate',
    amount,
  } = req.body as {
    account_number: string
    bank_code: string
    sourceProvider?: 'hilogate' | 'oy' | 'gidi' | 'ing1'
    amount?: number
  }

  try {
    if (sourceProvider === 'ing1') {
      const merchant = await prisma.merchant.findFirst({
        where: { name: 'ing1' },
      })
      if (!merchant) {
        return res.status(500).json({ error: 'Internal ING1 merchant not found' })
      }

      const subs = await getActiveProviders(merchant.id, 'ing1', {})
      if (subs.length === 0) {
        return res.status(500).json({ error: 'No active ING1 credentials today' })
      }

      const cfg = subs[0].config as Ing1Config
      const client = new Ing1Client(cfg)
      const clientReff = `inq-${Date.now()}`
      const inquiry = await client.cashoutInquiry({
        bankCode: bank_code,
        accountNumber: account_number,
        amount: amount ?? 0,
        clientReff,
        merchantId: cfg.merchantId,
      })

      if (inquiry.status === 'FAILED') {
        return res.status(400).json({
          error: inquiry.message || 'Account inquiry failed',
          status: 'invalid',
          rc: inquiry.rc,
        })
      }

      return res.json({
        account_number: inquiry.accountNumber ?? account_number,
        account_holder: inquiry.accountName ?? '',
        bank_code: inquiry.bankCode ?? bank_code,
        bank_name: inquiry.bankName ?? null,
        status: inquiry.status === 'PAID' ? 'valid' : 'pending',
        rc: inquiry.rc,
        reff: inquiry.reff ?? null,
        client_reff: inquiry.clientReff ?? clientReff,
        message: inquiry.message ?? '',
      })
    }

    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' },
    })
    if (!merchant) {
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' })
    }

    const pc = await prisma.partnerClient.findUnique({
      where: { id: req.partnerClientId! },
      select: { forceSchedule: true },
    })
    const subs = await getActiveProviders(merchant.id, 'hilogate', {
      schedule: (pc?.forceSchedule as any) || undefined,
    })
    if (subs.length === 0) {
      return res.status(500).json({ error: 'No active Hilogate credentials today' })
    }
    const cfg = subs[0].config as unknown as HilogateConfig

    const client = new HilogateClient(cfg)
    const payload = await client.validateAccount(account_number, bank_code)
    if (payload.status !== 'valid') {
      return res.status(400).json({ error: 'Invalid account' })
    }

    return res.json({
      account_number: payload.account_number,
      account_holder: payload.account_holder,
      bank_code: payload.bank_code,
      status: payload.status,
    })
  } catch (err: any) {
    console.error('[validateAccount] error:', err)
    return res
      .status(500)
      .json({ message: err.message || 'Validasi akun gagal' })
  }
}

export async function validateAccountS2S(req: ApiKeyRequest, res: Response) {
  const {
    account_number,
    bank_code,
    sourceProvider = 'hilogate',
    amount,
  } = req.body as {
    account_number: string
    bank_code: string
    sourceProvider?: 'hilogate' | 'oy' | 'gidi' | 'ing1'
    amount?: number
  }

  try {
    if (sourceProvider === 'ing1') {
      const merchant = await prisma.merchant.findFirst({
        where: { name: 'ing1' },
      })
      if (!merchant) {
        return res.status(500).json({ error: 'Internal ING1 merchant not found' })
      }

      const subs = await getActiveProviders(merchant.id, 'ing1', {})
      if (subs.length === 0) {
        return res.status(500).json({ error: 'No active ING1 credentials today' })
      }

      const cfg = subs[0].config as Ing1Config
      const client = new Ing1Client(cfg)
      const clientReff = `inq-${Date.now()}`
      const inquiry = await client.cashoutInquiry({
        bankCode: bank_code,
        accountNumber: account_number,
        amount: amount ?? 0,
        clientReff,
        merchantId: cfg.merchantId,
      })

      if (inquiry.status === 'FAILED') {
        return res.status(400).json({
          error: inquiry.message || 'Account inquiry failed',
          status: 'invalid',
          rc: inquiry.rc,
        })
      }

      return res.json({
        account_number: inquiry.accountNumber ?? account_number,
        account_holder: inquiry.accountName ?? '',
        bank_code: inquiry.bankCode ?? bank_code,
        bank_name: inquiry.bankName ?? null,
        status: inquiry.status === 'PAID' ? 'valid' : 'pending',
        rc: inquiry.rc,
        reff: inquiry.reff ?? null,
        client_reff: inquiry.clientReff ?? clientReff,
        message: inquiry.message ?? '',
      })
    }

    const merchant = await prisma.merchant.findFirst({
      where: { name: 'hilogate' },
    })
    if (!merchant) {
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' })
    }

    const pc = await prisma.partnerClient.findUnique({
      where: { id: req.clientId! },
      select: { forceSchedule: true },
    })
    const subs = await getActiveProviders(merchant.id, 'hilogate', {
      schedule: (pc?.forceSchedule as any) || undefined,
    })
    if (subs.length === 0) {
      return res.status(500).json({ error: 'No active Hilogate credentials today' })
    }
    const cfg = subs[0].config as unknown as HilogateConfig

    const client = new HilogateClient(cfg)
    const payload = await client.validateAccount(account_number, bank_code)
    if (payload.status !== 'valid') {
      return res.status(400).json({ error: 'Invalid account' })
    }
    return res.json({
      account_number: payload.account_number,
      account_holder: payload.account_holder,
      bank_code: payload.bank_code,
      status: payload.status,
    })
  } catch (err: any) {
    console.error('[validateAccountS2S] error:', err)
    return res.status(500).json({ message: err.message || 'Validasi akun gagal' })
  }
}

/**
 * POST /api/v1/client/dashboard/withdraw
 */
export const requestWithdraw = async (req: ClientAuthRequest, res: Response) => {
  const {
    subMerchantId,
    sourceProvider,
    account_number,
    bank_code,
    account_name_alias,
    amount,
    otp 
   } = req.body as {
    subMerchantId: string
    sourceProvider: 'hilogate' | 'oy' | 'gidi' | 'ing1'
    account_number: string
    bank_code: string
    account_name_alias?: string
    amount: number
    otp?: string

  }

    // Parent accounts are not allowed to perform withdrawals
  if (req.isParent) {
    return res.status(403).json({ error: 'Parent accounts cannot perform withdrawals' })
  }
  const clientUserId = req.clientUserId!

  // 0) Cari partnerClientId dari clientUser
  const user = await prisma.clientUser.findUnique({
    where: { id: clientUserId },
    select: { partnerClientId: true, totpEnabled: true, totpSecret: true }
  })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
  const partnerClientId = user.partnerClientId
  if (user.totpEnabled) {
    if (!otp) return res.status(400).json({ error: 'OTP wajib diisi' })
    if (!user.totpSecret || !authenticator.check(String(otp), user.totpSecret)) {
      return res.status(400).json({ error: 'OTP tidak valid' })
    }
  }

    // 0a) Validate against global withdraw limits
  const [minSet, maxSet] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'withdraw_min' } }),
    prisma.setting.findUnique({ where: { key: 'withdraw_max' } })
  ])
  const minVal = parseFloat(minSet?.value ?? '0')
  const maxVal = parseFloat(maxSet?.value ?? '0')
  if (!isNaN(minVal) && minVal > 0 && amount < minVal) {
    return res.status(400).json({ error: `Minimum withdraw Rp ${minVal}` })
  }
  if (!isNaN(maxVal) && maxVal > 0 && amount > maxVal) {
    return res.status(400).json({ error: `Maximum withdraw Rp ${maxVal}` })
  }

  try {
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: subMerchantId },
      select: { credentials: true, provider: true }
    })
    if (!sub) throw new Error('Credentials not found for sub-merchant')

    // Cast sesuai provider
    let providerCfg: any
    let hilogateClient: HilogateClient | null = null
    let oyClient: OyClient | null = null
    let gidiClient: GidiClient | null = null
    let ingClient: Ing1Client | null = null
    let ingCfg: Ing1Config | null = null

    if (sourceProvider === 'hilogate') {
      const raw = sub.credentials as { merchantId: string; secretKey: string; env?: string }
      providerCfg = {
        merchantId: raw.merchantId,
        secretKey: raw.secretKey,
        env: raw.env ?? 'sandbox',
      } as HilogateConfig
      hilogateClient = new HilogateClient(providerCfg)
    } else if (sourceProvider === 'oy') {
      const raw = sub.credentials as { merchantId: string; secretKey: string }
      providerCfg = {
        baseUrl: 'https://partner.oyindonesia.com',
        username: raw.merchantId,
        apiKey: raw.secretKey,
      } as OyConfig
      oyClient = new OyClient(providerCfg)
    } else if (sourceProvider === 'gidi') {
      const raw = sub.credentials as { baseUrl: string; merchantId: string; credentialKey: string }
      providerCfg = {
        baseUrl: raw.baseUrl,
        merchantId: raw.merchantId,
        credentialKey: raw.credentialKey,
      } as GidiDisbursementConfig
      gidiClient = new GidiClient(providerCfg)
    } else {
      const raw = sub.credentials as unknown as Ing1Config
      ingCfg = {
        baseUrl: raw.baseUrl,
        email: raw.email,
        password: raw.password,
        productCode: raw.productCode,
        callbackUrl: raw.callbackUrl,
        permanentToken: raw.permanentToken,
        merchantId: raw.merchantId,
        apiVersion: raw.apiVersion,
      }
      providerCfg = ingCfg
      ingClient = new Ing1Client(ingCfg)
    }

    const withdrawRef = `wd-${Date.now()}`

    // 3-4) Validasi akun & dapatkan bankName / holder
    let acctHolder: string
    let alias: string
    let bankName: string
    if (sourceProvider === 'hilogate') {
      const valid = await hilogateClient!.validateAccount(account_number, bank_code)
      if (valid.status !== 'valid') {
        return res.status(400).json({ error: 'Akun bank tidak valid' })
      }
      acctHolder = valid.account_holder
      alias = account_name_alias || acctHolder
      const banks = await hilogateClient!.getBankCodes()
      const b = banks.find(b => b.code === bank_code)
      if (!b) return res.status(400).json({ error: 'Bank code tidak dikenal' })
      bankName = b.name
    } else if (sourceProvider === 'gidi') {
      let inq
      try {
        inq = await gidiClient!.inquiryAccount(bank_code, account_number, Date.now().toString())
      } catch (err: any) {
        return res.status(400).json({ error: err.message })
      }
      acctHolder = inq.beneficiaryAccountName
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name
    } else if (sourceProvider === 'oy') {
      acctHolder = req.body.account_name || ''
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name
    } else {
      acctHolder = req.body.account_name || ''
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name || ''
    }

    // 5) Atomic transaction: hitung balance, fee, buat record, hold saldo
    const wr = await prisma.$transaction(async tx => {
      // a) Ambil fee withdraw
      const pc = await tx.partnerClient.findUniqueOrThrow({
        where: { id: partnerClientId },
        select: { withdrawFeePercent: true, withdrawFeeFlat: true }
      })

      // b) Hitung total masuk (settled) dari transaction_request
  const inAgg = await tx.order.aggregate({
    _sum: { settlementAmount: true },
    where: {
      subMerchantId,
      partnerClientId,
      settlementTime: { not: null }
    }
  })
      const totalIn = inAgg._sum.settlementAmount ?? 0

      // c) Hitung total keluar (withdraw) dari WithdrawRequest
      const outAgg = await tx.withdrawRequest.aggregate({
        _sum: { amount: true },
        where: {
          subMerchantId,
          partnerClientId,
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
        }
      })
      const totalOut = outAgg._sum.amount ?? 0

      // d) Validasi available balance
      const available = totalIn - totalOut
      if (amount > available) throw new Error('InsufficientBalance')

      // e) Hitung fee dan net amount
      const feePctAmt = (pc.withdrawFeePercent / 100) * amount
      const netAmt = amount - feePctAmt - pc.withdrawFeeFlat

      // f) Buat WithdrawRequest dengan nested connect
      const refId = withdrawRef
      const w = await tx.withdrawRequest.create({
        data: {
          refId,
          amount,
          netAmount: netAmt,
          status: DisbursementStatus.PENDING,
          withdrawFeePercent: pc.withdrawFeePercent,
          withdrawFeeFlat: pc.withdrawFeeFlat,
          sourceProvider,
          partnerClient: { connect: { id: partnerClientId } },
          subMerchant:    { connect: { id: subMerchantId } },
          accountName:      acctHolder,
          accountNameAlias: alias,
          accountNumber:    account_number,
          bankCode:         bank_code,
          bankName
        }
      })

      // g) Hold saldo di PartnerClient
      await tx.partnerClient.update({
        where: { id: partnerClientId },
        data: { balance: { decrement: amount } }
      })

      return w
    })

       try {
      let resp: any
      let ingInquiry: {
        reff?: string | null
        fee?: number | null
        accountName?: string | null
        bankName?: string | null
      } | null = null

      if (sourceProvider === 'hilogate') {
        resp = await hilogateClient!.createWithdrawal({
          ref_id:             wr.refId,
          amount:             wr.netAmount,                // ← netAmt
          currency:           'IDR',
          account_number,
          account_name:       wr.accountName,
          account_name_alias: wr.accountNameAlias,
          bank_code,
          bank_name:          wr.bankName,
          branch_name:        '',
          description:        `Withdraw Rp ${wr.netAmount}` // ← catatan juga netAmt
        })
      } else if (sourceProvider === 'gidi') {
        resp = await gidiClient!.createTransfer({
          requestId: `${wr.refId}-r`,
          transactionId: wr.refId,
          channelId: bank_code,
          accountNo: account_number,
          amount: wr.netAmount,
          transferNote: `Withdraw Rp ${wr.netAmount}`,
        })
      } else if (sourceProvider === 'oy') {
        const disburseReq = {
          recipient_bank:     bank_code,
          recipient_account:  account_number,
          amount:             wr.netAmount,                // ← netAmt
          note:               `Withdraw Rp ${wr.netAmount}`, // ← catatan juga netAmt
          partner_trx_id:     wr.refId,
          email:             'client@launcx.com',  // ← hardcode di sini'

        }
        resp = await oyClient!.disburse(disburseReq)
      } else {
        if (!ingClient || !ingCfg) throw new Error('Missing ING1 client configuration')
        const inquiryAmount = wr.netAmount ?? amount
        const inquiry = await ingClient.cashoutInquiry({
          bankCode: bank_code,
          accountNumber: account_number,
          amount: inquiryAmount,
          clientReff: wr.refId,
          merchantId: ingCfg.merchantId,
        })

        if (inquiry.status === 'FAILED' || !inquiry.reff) {
          await prisma.$transaction([
            prisma.withdrawRequest.update({
              where: { refId: wr.refId },
              data: {
                status: DisbursementStatus.FAILED,
                paymentGatewayId: inquiry.reff ?? undefined,
                accountName: inquiry.accountName ?? wr.accountName,
                bankName: inquiry.bankName ?? wr.bankName,
              },
            }),
            prisma.partnerClient.update({
              where: { id: partnerClientId },
              data: { balance: { increment: amount } },
            }),
          ])
          return res.status(400).json({
            error: inquiry.message || 'Withdrawal inquiry failed',
            status: DisbursementStatus.FAILED,
            rc: inquiry.rc,
          })
        }

        ingInquiry = {
          reff: inquiry.reff ?? null,
          fee: inquiry.fee ?? null,
          accountName: inquiry.accountName ?? null,
          bankName: inquiry.bankName ?? null,
        }

        const aliasToStore = wr.accountNameAlias || ingInquiry.accountName || wr.accountName
        const feeCandidate =
          typeof ingInquiry.fee === 'number' ? ingInquiry.fee : parseIng1Number(ingInquiry.fee)

        await prisma.withdrawRequest.update({
          where: { refId: wr.refId },
          data: {
            accountName: ingInquiry.accountName ?? wr.accountName,
            accountNameAlias: aliasToStore ?? wr.accountNameAlias,
            bankName: ingInquiry.bankName ?? wr.bankName,
            paymentGatewayId: ingInquiry.reff ?? wr.paymentGatewayId,
            ...(feeCandidate != null ? { pgFee: feeCandidate } : {}),
          },
        })

        resp = await ingClient.cashoutPayment({
          reff: ingInquiry.reff!,
          clientReff: wr.refId,
          amount: inquiryAmount,
          merchantId: ingCfg.merchantId,
        })
      }

      // Map response code ke DisbursementStatus
      const newStatus = sourceProvider === 'hilogate'
        ? (['WAITING','PENDING'].includes(resp.status)
            ? DisbursementStatus.PENDING
            : ['COMPLETED','SUCCESS'].includes(resp.status)
              ? DisbursementStatus.COMPLETED
              : DisbursementStatus.FAILED)
        : sourceProvider === 'gidi'
          ? (resp.statusTransfer === 'Success'
              ? DisbursementStatus.COMPLETED
              : resp.statusTransfer === 'Failed'
                ? DisbursementStatus.FAILED
                : DisbursementStatus.PENDING)
          : sourceProvider === 'oy'
            ? (resp.status.code === '101'
                ? DisbursementStatus.PENDING
                : resp.status.code === '000'
                  ? DisbursementStatus.COMPLETED
                  : DisbursementStatus.FAILED)
            : mapIng1ToDisbursement(resp.rc, typeof resp?.raw?.status === 'string' ? resp.raw.status : resp.status)

      // Update withdrawal record
      await prisma.withdrawRequest.update({
        where: { refId: wr.refId },
        data: {
          paymentGatewayId:
            sourceProvider === 'ing1'
              ? resp.reff ?? resp.raw?.reff ?? ingInquiry?.reff ?? null
              : resp.trx_id || resp.trxId || resp.transactionId,
          isTransferProcess: sourceProvider === 'hilogate' ? (resp.is_transfer_process ?? false) : true,
          status: newStatus,
          ...(sourceProvider === 'ing1'
            ? (() => {
                const feeRaw =
                  parseIng1Number(resp?.data?.fee ?? resp?.data?.total_fee ?? resp?.data?.admin_fee?.total_fee) ??
                  (typeof ingInquiry?.fee === 'number' ? ingInquiry.fee : null)
                return feeRaw != null ? { pgFee: feeRaw } : {}
              })()
            : {}),
        }
      })

      if (newStatus === DisbursementStatus.FAILED) {
        await prisma.partnerClient.update({
          where: { id: partnerClientId },
          data: { balance: { increment: amount } }
        })
        return res.status(400).json({ error: 'Withdrawal failed', status: resp.status })
      }   

      return res.status(201).json({ id: wr.id, refId: wr.refId, status: newStatus })
    } catch (err: any) {
      logger.error('[requestWithdraw provider]', err)
      try {
        await prisma.$transaction([
          prisma.withdrawRequest.update({
            where: { refId: wr.refId },
            data: { status: DisbursementStatus.FAILED }
          }),
          prisma.partnerClient.update({
            where: { id: partnerClientId },
            data: { balance: { increment: amount } }
          })
        ])
      } catch (rollbackErr) {
        logger.error('[requestWithdraw rollback]', rollbackErr)
      }
      const status = err instanceof GidiError ? 400 : 500
      return res.status(status).json({ error: err.message || 'Internal server error' })
    }
  } catch (err: any) {
    if (err.message === 'InsufficientBalance')
      return res.status(400).json({ error: 'Saldo tidak mencukupi' })
    if (err instanceof GidiError)
      return res.status(400).json({ error: err.message })
    logger.error('[requestWithdraw]', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

export const requestWithdrawS2S = async (req: ApiKeyRequest, res: Response) => {
  const {
    subMerchantId,
    sourceProvider,
    account_number,
    bank_code,
    account_name_alias,
    amount,
  } = req.body as {
    subMerchantId: string
    sourceProvider: 'hilogate' | 'oy' | 'gidi' | 'ing1'
    account_number: string
    bank_code: string
    account_name_alias?: string
    amount: number
  }

  if (req.isParent) {
    return res.status(403).json({ error: 'Parent accounts cannot perform withdrawals' })
  }
  const partnerClientId = req.clientId!

  const [minSet, maxSet] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'withdraw_min' } }),
    prisma.setting.findUnique({ where: { key: 'withdraw_max' } }),
  ])
  const minVal = parseFloat(minSet?.value ?? '0')
  const maxVal = parseFloat(maxSet?.value ?? '0')
  if (!isNaN(minVal) && minVal > 0 && amount < minVal) {
    return res.status(400).json({ error: `Minimum withdraw Rp ${minVal}` })
  }
  if (!isNaN(maxVal) && maxVal > 0 && amount > maxVal) {
    return res.status(400).json({ error: `Maximum withdraw Rp ${maxVal}` })
  }

  try {
    const sub = await prisma.sub_merchant.findUnique({
      where: { id: subMerchantId },
      select: { credentials: true, provider: true },
    })
    if (!sub) throw new Error('Credentials not found for sub-merchant')

    let providerCfg: any
    let hilogateClient: HilogateClient | null = null
    let oyClient: OyClient | null = null
    let gidiClient: GidiClient | null = null
    let ingClient: Ing1Client | null = null
    let ingCfg: Ing1Config | null = null

    if (sourceProvider === 'hilogate') {
      const raw = sub.credentials as { merchantId: string; secretKey: string; env?: string }
      providerCfg = {
        merchantId: raw.merchantId,
        secretKey: raw.secretKey,
        env: raw.env ?? 'sandbox',
      } as HilogateConfig
      hilogateClient = new HilogateClient(providerCfg)
    } else if (sourceProvider === 'oy') {
      const raw = sub.credentials as { merchantId: string; secretKey: string }
      providerCfg = {
        baseUrl: 'https://partner.oyindonesia.com',
        username: raw.merchantId,
        apiKey: raw.secretKey,
      } as OyConfig
      oyClient = new OyClient(providerCfg)
    } else if (sourceProvider === 'gidi') {
      const raw = sub.credentials as { baseUrl: string; merchantId: string; credentialKey: string }
      providerCfg = {
        baseUrl: raw.baseUrl,
        merchantId: raw.merchantId,
        credentialKey: raw.credentialKey,
      } as GidiDisbursementConfig
      gidiClient = new GidiClient(providerCfg)
    } else {
      const raw = sub.credentials as unknown as Ing1Config
      ingCfg = {
        baseUrl: raw.baseUrl,
        email: raw.email,
        password: raw.password,
        productCode: raw.productCode,
        callbackUrl: raw.callbackUrl,
        permanentToken: raw.permanentToken,
        merchantId: raw.merchantId,
        apiVersion: raw.apiVersion,
      }
      providerCfg = ingCfg
      ingClient = new Ing1Client(ingCfg)
    }

    const withdrawRef = `wd-${Date.now()}`

    let acctHolder: string
    let alias: string
    let bankName: string
    if (sourceProvider === 'hilogate') {
      const valid = await hilogateClient!.validateAccount(account_number, bank_code)
      if (valid.status !== 'valid') {
        return res.status(400).json({ error: 'Akun bank tidak valid' })
      }
      acctHolder = valid.account_holder
      alias = account_name_alias || acctHolder
      const banks = await hilogateClient!.getBankCodes()
      const b = banks.find(b => b.code === bank_code)
      if (!b) return res.status(400).json({ error: 'Bank code tidak dikenal' })
      bankName = b.name
    } else if (sourceProvider === 'gidi') {
      let inq
      try {
        inq = await gidiClient!.inquiryAccount(bank_code, account_number, Date.now().toString())
      } catch (err: any) {
        return res.status(400).json({ error: err.message })
      }
      acctHolder = inq.beneficiaryAccountName
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name
    } else if (sourceProvider === 'oy') {
      acctHolder = req.body.account_name || ''
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name
    } else {
      acctHolder = req.body.account_name || ''
      alias = account_name_alias || acctHolder
      bankName = req.body.bank_name || ''
    }

    const wr = await prisma.$transaction(async tx => {
      const pc = await tx.partnerClient.findUniqueOrThrow({
        where: { id: partnerClientId },
        select: { withdrawFeePercent: true, withdrawFeeFlat: true },
      })

      const inAgg = await tx.order.aggregate({
        _sum: { settlementAmount: true },
        where: {
          subMerchantId,
          partnerClientId,
          settlementTime: { not: null },
        },
      })
      const totalIn = inAgg._sum.settlementAmount ?? 0

      const outAgg = await tx.withdrawRequest.aggregate({
        _sum: { amount: true },
        where: {
          subMerchantId,
          partnerClientId,
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] },
        },
      })
      const totalOut = outAgg._sum.amount ?? 0

      const available = totalIn - totalOut
      if (amount > available) throw new Error('InsufficientBalance')

      const feePctAmt = (pc.withdrawFeePercent / 100) * amount
      const netAmt = amount - feePctAmt - pc.withdrawFeeFlat

      const refId = withdrawRef
      const w = await tx.withdrawRequest.create({
        data: {
          refId,
          amount,
          netAmount: netAmt,
          status: DisbursementStatus.PENDING,
          withdrawFeePercent: pc.withdrawFeePercent,
          withdrawFeeFlat: pc.withdrawFeeFlat,
          sourceProvider,
          partnerClient: { connect: { id: partnerClientId } },
          subMerchant: { connect: { id: subMerchantId } },
          accountName: acctHolder,
          accountNameAlias: alias,
          accountNumber: account_number,
          bankCode: bank_code,
          bankName,
        },
      })

      await tx.partnerClient.update({
        where: { id: partnerClientId },
        data: { balance: { decrement: amount } },
      })

      return w
    })

    try {
      let resp: any
      let ingInquiry: {
        reff?: string | null
        fee?: number | null
        accountName?: string | null
        bankName?: string | null
      } | null = null

      if (sourceProvider === 'hilogate') {
        resp = await hilogateClient!.createWithdrawal({
          ref_id: wr.refId,
          amount: wr.netAmount,
          currency: 'IDR',
          account_number,
          account_name: wr.accountName,
          account_name_alias: wr.accountNameAlias,
          bank_code,
          bank_name: wr.bankName,
          branch_name: '',
          description: `Withdraw Rp ${wr.netAmount}`,
        })
      } else if (sourceProvider === 'gidi') {
        resp = await gidiClient!.createTransfer({
          requestId: `${wr.refId}-r`,
          transactionId: wr.refId,
          channelId: bank_code,
          accountNo: account_number,
          amount: wr.netAmount,
          transferNote: `Withdraw Rp ${wr.netAmount}`,
        })
      } else if (sourceProvider === 'oy') {
        const disburseReq = {
          recipient_bank: bank_code,
          recipient_account: account_number,
          amount: wr.netAmount,
          note: `Withdraw Rp ${wr.netAmount}`,
          partner_trx_id: wr.refId,
          email: 'client@launcx.com',
        }
        resp = await oyClient!.disburse(disburseReq)
      } else {
        if (!ingClient || !ingCfg) throw new Error('Missing ING1 client configuration')
        const inquiryAmount = wr.netAmount ?? amount
        const inquiry = await ingClient.cashoutInquiry({
          bankCode: bank_code,
          accountNumber: account_number,
          amount: inquiryAmount,
          clientReff: wr.refId,
          merchantId: ingCfg.merchantId,
        })

        if (inquiry.status === 'FAILED' || !inquiry.reff) {
          await prisma.$transaction([
            prisma.withdrawRequest.update({
              where: { refId: wr.refId },
              data: {
                status: DisbursementStatus.FAILED,
                paymentGatewayId: inquiry.reff ?? undefined,
                accountName: inquiry.accountName ?? wr.accountName,
                bankName: inquiry.bankName ?? wr.bankName,
              },
            }),
            prisma.partnerClient.update({
              where: { id: partnerClientId },
              data: { balance: { increment: amount } },
            }),
          ])
          return res.status(400).json({
            error: inquiry.message || 'Withdrawal inquiry failed',
            status: DisbursementStatus.FAILED,
            rc: inquiry.rc,
          })
        }

        ingInquiry = {
          reff: inquiry.reff ?? null,
          fee: inquiry.fee ?? null,
          accountName: inquiry.accountName ?? null,
          bankName: inquiry.bankName ?? null,
        }

        const aliasToStore = wr.accountNameAlias || ingInquiry.accountName || wr.accountName
        const feeCandidate =
          typeof ingInquiry.fee === 'number' ? ingInquiry.fee : parseIng1Number(ingInquiry.fee)

        await prisma.withdrawRequest.update({
          where: { refId: wr.refId },
          data: {
            accountName: ingInquiry.accountName ?? wr.accountName,
            accountNameAlias: aliasToStore ?? wr.accountNameAlias,
            bankName: ingInquiry.bankName ?? wr.bankName,
            paymentGatewayId: ingInquiry.reff ?? wr.paymentGatewayId,
            ...(feeCandidate != null ? { pgFee: feeCandidate } : {}),
          },
        })

        resp = await ingClient.cashoutPayment({
          reff: ingInquiry.reff!,
          clientReff: wr.refId,
          amount: inquiryAmount,
          merchantId: ingCfg.merchantId,
        })
      }

      const newStatus =
        sourceProvider === 'hilogate'
          ? ['WAITING', 'PENDING'].includes(resp.status)
            ? DisbursementStatus.PENDING
            : ['COMPLETED', 'SUCCESS'].includes(resp.status)
              ? DisbursementStatus.COMPLETED
              : DisbursementStatus.FAILED
          : sourceProvider === 'gidi'
            ? resp.statusTransfer === 'Success'
              ? DisbursementStatus.COMPLETED
              : resp.statusTransfer === 'Failed'
                ? DisbursementStatus.FAILED
                : DisbursementStatus.PENDING
            : sourceProvider === 'oy'
              ? resp.status.code === '101'
                ? DisbursementStatus.PENDING
                : resp.status.code === '000'
                  ? DisbursementStatus.COMPLETED
                  : DisbursementStatus.FAILED
              : mapIng1ToDisbursement(resp.rc, typeof resp?.raw?.status === 'string' ? resp.raw.status : resp.status)

      await prisma.withdrawRequest.update({
        where: { refId: wr.refId },
        data: {
          paymentGatewayId:
            sourceProvider === 'ing1'
              ? resp.reff ?? resp.raw?.reff ?? ingInquiry?.reff ?? null
              : resp.trx_id || resp.trxId || resp.transactionId,
          isTransferProcess:
            sourceProvider === 'hilogate' ? resp.is_transfer_process ?? false : true,
          status: newStatus,
          ...(sourceProvider === 'ing1'
            ? (() => {
                const feeRaw =
                  parseIng1Number(resp?.data?.fee ?? resp?.data?.total_fee ?? resp?.data?.admin_fee?.total_fee) ??
                  (typeof ingInquiry?.fee === 'number' ? ingInquiry.fee : null)
                return feeRaw != null ? { pgFee: feeRaw } : {}
              })()
            : {}),
        },
      })

      if (newStatus === DisbursementStatus.FAILED) {
        await prisma.partnerClient.update({
          where: { id: partnerClientId },
          data: { balance: { increment: amount } },
        })
        return res.status(400).json({ error: 'Withdrawal failed', status: resp.status })
      }

      return res.status(201).json({ id: wr.id, refId: wr.refId, status: newStatus })
    } catch (err: any) {
      logger.error('[requestWithdrawS2S provider]', err)
      try {
        await prisma.$transaction([
          prisma.withdrawRequest.update({
            where: { refId: wr.refId },
            data: { status: DisbursementStatus.FAILED },
          }),
          prisma.partnerClient.update({
            where: { id: partnerClientId },
            data: { balance: { increment: amount } },
          }),
        ])
      } catch (rollbackErr) {
        logger.error('[requestWithdrawS2S rollback]', rollbackErr)
      }
      const status = err instanceof GidiError ? 400 : 500
      return res.status(status).json({ error: err.message || 'Internal server error' })
    }
  } catch (err: any) {
    if (err.message === 'InsufficientBalance')
      return res.status(400).json({ error: 'Saldo tidak mencukupi' })
    if (err instanceof GidiError)
      return res.status(400).json({ error: err.message })
    logger.error('[requestWithdrawS2S]', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
