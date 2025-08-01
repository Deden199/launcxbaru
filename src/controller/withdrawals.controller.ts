import { Request, Response } from 'express'
import { prisma } from '../core/prisma'
import { retryDisbursement } from '../service/hilogate.service'
import { ClientAuthRequest } from '../middleware/clientAuth'
import { HilogateClient,HilogateConfig } from '../service/hilogateClient'
import crypto from 'crypto'
import { config } from '../config'
import logger from '../logger'
import { DisbursementStatus } from '@prisma/client'
import { getActiveProviders } from '../service/provider';
import {OyClient,OyConfig}          from '../service/oyClient'    // sesuaikan path
import { authenticator } from 'otplib'
import { parseDateSafely } from '../util/time'



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
  const { clientId: qClientId, status, date_from, date_to, page = '1', limit = '20' } = req.query;
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
            where: { refId, status: DisbursementStatus.PENDING },
            data: updateData,
          })
        : prisma.withdrawRequest.updateMany({
            where: { refId, status: DisbursementStatus.PENDING },
            data: updateData,

          }))
    )

    // 7) Jika gagal & memang pertama kali gagal, refund
    if (!isAdmin && count > 0 && newStatus === DisbursementStatus.FAILED) {
      await retry(() =>
        prisma.partnerClient.update({
          where: { id: wr!.partnerClientId },
          data: { balance: { increment: wr!.amount } },
        })
      )
    }

    return res.status(200).json({ message: 'OK' })
  } catch (err: any) {
    console.error('[withdrawalCallback] error:', err)
    return res.status(500).json({ error: err.message })
  }
}
export async function validateAccount(req: ClientAuthRequest, res: Response) {
  const { account_number, bank_code } = req.body;

  try {
    // 1) Temukan internal merchant Hilogate
 const merchant = await prisma.merchant.findFirst({
   where: { name: 'hilogate' },
    });
    if (!merchant) {
      return res.status(500).json({ error: 'Internal Hilogate merchant not found' });
    }

    // 2) Ambil kredensial aktif (weekday/weekend) dari DB
    const pc = await prisma.partnerClient.findUnique({
      where: { id: req.partnerClientId! },
      select: { forceSchedule: true },
    });
    const subs = await getActiveProviders(merchant.id, 'hilogate', {
      schedule: pc?.forceSchedule as any || undefined,
    });
    if (subs.length === 0) {
      return res.status(500).json({ error: 'No active Hilogate credentials today' });
    }
 const cfg = subs[0].config as unknown as HilogateConfig;

    // 3) Instansiasi client dengan kredensial DB
    const client = new HilogateClient(cfg);

    // 4) Panggil validateAccount
    const payload = await client.validateAccount(account_number, bank_code);

    // 5) Periksa hasil
    if (payload.status !== 'valid') {
      return res.status(400).json({ error: 'Invalid account' });
    }

    // 6) Kembalikan detail
    return res.json({
      account_number: payload.account_number,
      account_holder: payload.account_holder,
      bank_code:      payload.bank_code,
      status:         payload.status,
    });

  } catch (err: any) {
    console.error('[validateAccount] error:', err);
    return res
      .status(500)
      .json({ message: err.message || 'Validasi akun gagal' });
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
    sourceProvider: 'hilogate' | 'oy'
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
    if (sourceProvider === 'hilogate') {
      const raw = sub.credentials as { merchantId: string; secretKey: string; env?: string }
      providerCfg = {
        merchantId: raw.merchantId,
        secretKey:  raw.secretKey,
        env:        raw.env ?? 'sandbox'
      } as HilogateConfig
    } else {
      const raw = sub.credentials as { merchantId: string; secretKey: string }
      providerCfg = {
        baseUrl: 'https://partner.oyindonesia.com',
        username: raw.merchantId,
        apiKey:   raw.secretKey
      } as OyConfig
    }

    // 2) Instantiate PG client sesuai provider
    const pgClient = sourceProvider === 'hilogate'
      ? new HilogateClient(providerCfg)
      : new OyClient(providerCfg)

    // 3-4) Validasi akun & dapatkan bankName / holder
    let acctHolder: string
    let alias: string
    let bankName: string
    if (sourceProvider === 'hilogate') {
      const valid = await (pgClient as HilogateClient).validateAccount(account_number, bank_code)
      if (valid.status !== 'valid') {
        return res.status(400).json({ error: 'Akun bank tidak valid' })
      }
      acctHolder = valid.account_holder
      alias = account_name_alias || acctHolder
      const banks = await (pgClient as HilogateClient).getBankCodes()
      const b = banks.find(b => b.code === bank_code)
      if (!b) return res.status(400).json({ error: 'Bank code tidak dikenal' })
      bankName = b.name
    } else {
      // OY: skip lookup, gunakan alias atau kode sebagai label
  acctHolder = req.body.account_name || '';
  alias      = account_name_alias || acctHolder;
  bankName = req.body.bank_name;
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
      const refId = `wd-${Date.now()}`
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
      if (sourceProvider === 'hilogate') {
        resp = await (pgClient as HilogateClient).createWithdrawal({
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
      } else {
        const disburseReq = {
          recipient_bank:     bank_code,
          recipient_account:  account_number,
    amount:             wr.netAmount,                // ← netAmt
    note:               `Withdraw Rp ${wr.netAmount}`, // ← catatan juga netAmt
          partner_trx_id:     wr.refId,
    email:             'client@launcx.com',  // ← hardcode di sini'

        }
        resp = await (pgClient as OyClient).disburse(disburseReq)
      }

       // Map response code ke DisbursementStatus
      const newStatus = sourceProvider === 'hilogate'
        ? (['WAITING','PENDING'].includes(resp.status)
            ? DisbursementStatus.PENDING
            : ['COMPLETED','SUCCESS'].includes(resp.status)
              ? DisbursementStatus.COMPLETED
              : DisbursementStatus.FAILED)
        : (resp.status.code === '101'
            ? DisbursementStatus.PENDING
            : resp.status.code === '000'
              ? DisbursementStatus.COMPLETED
              : DisbursementStatus.FAILED)

      // Update withdrawal record
      await prisma.withdrawRequest.update({
        where: { refId: wr.refId },
        data: {
          paymentGatewayId:  resp.trx_id || resp.trxId,
          isTransferProcess: sourceProvider === 'hilogate' ? (resp.is_transfer_process ?? false) : true,
          status:            newStatus
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
      return res.status(500).json({ error: err.message || 'Internal server error' })
    }
  } catch (err: any) {
    if (err.message === 'InsufficientBalance')
      return res.status(400).json({ error: 'Saldo tidak mencukupi' })
    logger.error('[requestWithdraw]', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
