import { Request, Response } from 'express'
import { prisma } from '../core/prisma'
import { retryDisbursement } from '../service/hilogate.service'
import { ClientAuthRequest } from '../middleware/clientAuth'
import { HilogateClient,HilogateConfig } from '../service/hilogateClient'
import crypto from 'crypto'
import { config } from '../config'
import logger from '../logger'
import { DisbursementStatus } from '@prisma/client'
import { getActiveProviders, getProviderBySubId } from '../service/provider';
import {OyClient, OyConfig}          from '../service/oyClient'    // sesuaikan path



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
        settlementTime: { not: null }
      }
    })
    const totalIn = inAgg._sum.settlementAmount ?? 0

    // pending/completed out dari WithdrawRequest
    const outAgg = await prisma.withdrawRequest.aggregate({
      _sum: { netAmount: true },
      where: {
        subMerchantId: s.id,
        status:        { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
      }
    })
    const totalOut = outAgg._sum.netAmount ?? 0

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
  if (date_from || date_to) {
    where.createdAt = {};
    if (date_from) where.createdAt.gte = new Date(String(date_from));
    if (date_to)   where.createdAt.lte = new Date(String(date_to));
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
        accountNumber: true,
        amount:        true,
        status:        true,
        createdAt:     true,
        completedAt:   true,
      },
    }),
    prisma.withdrawRequest.count({ where }),
  ]);

  // 6) Format dan kirim
  const data = rows.map(w => ({
    refId:         w.refId,
    bankName:      w.bankName,
    accountNumber: w.accountNumber,
    amount:        w.amount,
    status:        w.status,
    createdAt:     w.createdAt.toISOString(),
    completedAt:   w.completedAt?.toISOString() ?? null,
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
    select: { refId: true, status: true, partnerClientId: true, subMerchantId: true }
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
    const result = await retryDisbursement(wr.refId, wr.subMerchantId);
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
    if (gotSig !== full.merchant_signature) {
      return res.status(400).json({ error: 'Invalid signature' })
    }

    // 3) Ambil payload
    const data = full.data ?? full
    const { ref_id, status, net_amount, completed_at } = data
    if (!ref_id || net_amount == null) {
      return res.status(400).json({ error: 'Invalid payload' })
    }

    // 4) Fetch record awal untuk cek refund
    const wr = await prisma.withdrawRequest.findUnique({
      where: { refId: ref_id },
      select: { amount: true, partnerClientId: true, status: true }
    })
    if (!wr) return res.status(404).send('Not found')

    // 5) Tentukan newStatus
    const up = status.toUpperCase()
    const newStatus: DisbursementStatus =
      up === 'COMPLETED' || up === 'SUCCESS'
        ? DisbursementStatus.COMPLETED
        : up === 'FAILED' || up === 'ERROR'
          ? DisbursementStatus.FAILED
          : DisbursementStatus.PENDING

    // 6) Idempotent update + retry
    const { count } = await retry<{ count: number }>(() =>
      prisma.withdrawRequest.updateMany({
        where: { refId: ref_id, status: DisbursementStatus.PENDING },
        data: {
          status:      newStatus,
          netAmount:   net_amount,
          completedAt: completed_at ? new Date(completed_at) : undefined,
        },
      })
    )

    // 7) Jika gagal & memang pertama kali gagal, refund
    if (count > 0 && newStatus === DisbursementStatus.FAILED) {
      await retry(() =>
        prisma.partnerClient.update({
          where: { id: wr.partnerClientId },
          data: { balance: { increment: wr.amount } },
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
  const { subMerchantId, account_number, bank_code } = req.body;

  try {
        if (!subMerchantId) {
      return res.status(400).json({ error: 'subMerchantId is required' });
    }

    // 1) Ambil kredensial sub-merchant langsung
    const sub = await getProviderBySubId(subMerchantId);
    if (!sub || sub.provider !== 'hilogate') {
      return res.status(400).json({ error: 'Invalid subMerchantId' });
    }
    const cfg = sub.config as HilogateConfig;

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
    amount
  } = req.body as {
    subMerchantId: string
    sourceProvider: 'hilogate' | 'oy'
    account_number: string
    bank_code: string
    account_name_alias?: string
    amount: number
  }
  const clientUserId = req.clientUserId!

  // 0) Cari partnerClientId dari clientUser
  const user = await prisma.clientUser.findUnique({
    where: { id: clientUserId },
    select: { partnerClientId: true }
  })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
  const partnerClientId = user.partnerClientId

  try {
        if (!subMerchantId) {
      return res.status(400).json({ error: 'subMerchantId is required' });
    }

    // 1) Ambil konfigurasi credentials dari sub-merchant
    const sub = await getProviderBySubId(subMerchantId)
    if (!sub) throw new Error('SubMerchantNotFound')
    if (
      (sourceProvider === 'hilogate' && sub.provider !== 'hilogate') ||
      (sourceProvider === 'oy' && sub.provider !== 'oy')
    ) {
      return res.status(400).json({ error: 'Provider mismatch' })
    }
    const providerCfg = sub.config
    // 2) Instantiate PG client sesuai provider
    const pgClient = sourceProvider === 'hilogate'
      ? new HilogateClient(providerCfg as HilogateConfig)
      : new OyClient(providerCfg as OyConfig)

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
      acctHolder = account_name_alias || ''
      alias = acctHolder
      bankName = bank_code
    }

    // 5) Atomic transaction: hitung balance, fee, buat record, hold saldo
    const wr = await prisma.$transaction(async tx => {
      // a) Ambil fee withdraw
      const pc = await tx.partnerClient.findUniqueOrThrow({
        where: { id: partnerClientId },
        select: { withdrawFeePercent: true, withdrawFeeFlat: true }
      })

      // b) Hitung total masuk (settled) dari transaction_request
      const inAgg = await tx.transaction_request.aggregate({
        _sum: { settlementAmount: true },
        where: { subMerchantId, settlementAt: { not: null } }
      })
      const totalIn = inAgg._sum.settlementAmount ?? 0

      // c) Hitung total keluar (withdraw) dari WithdrawRequest
      const outAgg = await tx.withdrawRequest.aggregate({
        _sum: { netAmount: true },
        where: {
          subMerchantId,
          status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
        }
      })
      const totalOut = outAgg._sum.netAmount ?? 0

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

    // 6) Kirim ke provider & update status berdasarkan response
    let resp: any
    if (sourceProvider === 'hilogate') {
      resp = await (pgClient as HilogateClient).createWithdrawal({
        ref_id:             wr.refId,
        amount,
        currency:           'IDR',
        account_number,
        account_name:       wr.accountName,
        account_name_alias: wr.accountNameAlias,
        bank_code,
        bank_name:          wr.bankName,
        branch_name:        '',
        description:        `Withdraw Rp ${amount}`
      })
    } else {
      const disburseReq = {
        recipient_bank:     bank_code,
        recipient_account:  account_number,
        amount,
        note:               `Withdraw Rp ${amount}`,
        partner_trx_id:     wr.refId,
        email:              acctHolder
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

    return res.status(201).json({ id: wr.id, refId: wr.refId, status: newStatus })

  } catch (err: any) {
    if (err.message === 'InsufficientBalance')
      return res.status(400).json({ error: 'Saldo tidak mencukupi' })
    logger.error('[requestWithdraw]', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
