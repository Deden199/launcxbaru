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
    const { count } = await retry(() =>
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
    const subs = await getActiveProviders(merchant.id, 'hilogate');
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
  const { account_number, bank_code, account_name_alias, amount } = req.body;
  const clientUserId = req.clientUserId!;

  // 0) Ambil partnerClientId dari clientUser
  const user = await prisma.clientUser.findUnique({
    where: { id: clientUserId },
    select: { partnerClientId: true },
  });
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  const partnerClientId = user.partnerClientId;

  try {
    // 1) Ambil kredensial aktif dari DB (weekday/weekend)
    const subs = await getActiveProviders(partnerClientId, 'hilogate');
    if (!subs.length) throw new Error('No active Hilogate credentials');
    const cfg = subs[0].config as unknown as HilogateConfig;

    // 2) Instansiasi HilogateClient
    const client = new HilogateClient(cfg);

    // 3) Validasi account via Hilogate
    const valid = await client.validateAccount(account_number, bank_code);
    if (valid.status !== 'valid') {
      return res.status(400).json({ error: 'Akun bank tidak valid' });
    }

    // 4) Ambil nama bank dinamis
    const banks = await client.getBankCodes();
    const bankObj = banks.find(b => b.code === bank_code);
    if (!bankObj) {
      return res.status(400).json({ error: 'Bank code tidak dikenal' });
    }
    const acctHolder = valid.account_holder;
    const bankName   = bankObj.name;
    const alias      = account_name_alias ?? acctHolder;

    // 5) Atomic transaction: cek saldo + buat withdraw + hold saldo
    const wr = await prisma.$transaction(async tx => {
      const pc = await tx.partnerClient.findUniqueOrThrow({
        where: { id: partnerClientId },
        select: { balance: true, children: true },
      });
      if (pc.children.length > 0) throw new Error('ParentCannotWithdraw');
      if (amount > pc.balance) throw new Error('InsufficientBalance');

      const refId = `wd-${Date.now()}`;
      const w = await tx.withdrawRequest.create({
        data: {
          refId,
          partnerClientId,
          accountName:      acctHolder,
          accountNameAlias: alias,
          accountNumber:    account_number,
          bankCode:         bank_code,
          bankName,
          amount,
          status: DisbursementStatus.PENDING,
        },
      });
      await tx.partnerClient.update({
        where: { id: partnerClientId },
        data: { balance: { decrement: amount } },
      });
      return w;
    });

    // 6) Kirim ke Hilogate & update status
    const hg = await client.createWithdrawal({
      ref_id:             wr.refId,
      amount,
      currency:           'IDR',
      account_number,
      account_name:       acctHolder,
      account_name_alias: alias,
      bank_code,
      bank_name:          bankName,
      branch_name:        '',
      description:        `Withdraw Rp ${amount}`,
    });

    const newStatus: DisbursementStatus = 
      ['WAITING','PENDING','PROCESSING'].includes(hg.status)   ? DisbursementStatus.PENDING  :
      ['COMPLETED','SUCCESS'].includes(hg.status)             ? DisbursementStatus.COMPLETED :
                                                               DisbursementStatus.FAILED;

    await prisma.withdrawRequest.updateMany({
      where: { refId: wr.refId, status: DisbursementStatus.PENDING },
      data: {
        paymentGatewayId:  hg.id,
        isTransferProcess: hg.is_transfer_process,
        status:            newStatus,
      },
    });

    return res.status(201).json({ id: wr.id, refId: wr.refId, status: newStatus });

  } catch (err: any) {
    if (err.message === 'InsufficientBalance') {
      return res.status(400).json({ error: 'Saldo tidak mencukupi' });
    }
    if (err.message === 'ParentCannotWithdraw') {
      return res.status(403).json({ error: 'Parent tidak dapat menarik dana' });
    }
    logger.error('[requestWithdraw] error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};