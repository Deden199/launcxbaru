import { Request, Response } from 'express';
import { DisbursementStatus } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto'
import axios from 'axios'
import {HilogateClient ,HilogateConfig} from '../../service/hilogateClient'
import ExcelJS from 'exceljs'
import {OyClient,OyConfig}          from '../../service/oyClient'    // sesuaikan path
import { config } from '../../config';
import { isJakartaWeekend, formatDateJakarta, parseDateSafely } from '../../util/time'


import { prisma } from '../../core/prisma';

// 1. Create merchant (mdr wajib)
export const createMerchant = async (req: Request, res: Response) => {
  const { name, phoneNumber, email, telegram, mdr } = req.body;
  if (mdr == null) {
    return res.status(400).json({ error: 'mdr required' });
  }
  const merchant = await prisma.merchant.create({
    data: {
      name,
      phoneNumber,
      email,
      telegram,
      mdr: Number(mdr),
    },
  });
  res.status(201).json(merchant);
};

export const getAllMerchants = async (_req: Request, res: Response) => {
 // sekarang ambil list partnerClient (id & name saja)
 const list = await prisma.merchant.findMany({
    select: { id: true, name: true }
  });
  res.json(list);
};
export const getAllClient = async (_req: Request, res: Response) => {
 // sekarang ambil list partnerClient (id & name saja)
 const list = await prisma.partnerClient.findMany({
    select: { id: true, name: true }
  });
  res.json(list);
};


// 3. Get merchant by ID
export const getMerchantById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const merchant = await prisma.merchant.findUnique({ where: { id } });
  if (!merchant) {
    return res.status(404).json({ error: 'Merchant not found' });
  }
  res.json(merchant);
};

// 4. Update merchant (boleh ubah semua field termasuk mdr)
export const updateMerchant = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { mdr, ...rest } = req.body;
  const data: any = { ...rest };
  if (mdr != null) {
    data.mdr = Number(mdr);
  }
  const updated = await prisma.merchant.update({ where: { id }, data });
  res.json(updated);
};

// 5. Delete merchant
export const deleteMerchant = async (req: Request, res: Response) => {
  const { id } = req.params;
  await prisma.merchant.delete({ where: { id } });
  res.status(204).end();
};

// 6. Set fee rate (mdr) khusus
export const setFeeRate = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { mdr } = req.body;
  if (mdr == null) {
    return res.status(400).json({ error: 'mdr required' });
  }
  const merchant = await prisma.merchant.update({
    where: { id },
    data: { mdr: Number(mdr) },
  });
  res.json(merchant);
};

export const connectPG = async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.id;
  const { provider, credentials, fee, name } = req.body;

    // 1) Обязательные поля
    if (!provider || !credentials?.merchantId || !credentials?.secretKey || !name) {
      return res
        .status(400)
        .json({ error: 'provider, merchantId, secretKey, and name required' });
    }

    // 2) Дефолт для schedule
    const rawSched = req.body.schedule;
    const schedule =
      rawSched &&
      typeof rawSched.weekday === 'boolean' &&
      typeof rawSched.weekend === 'boolean'
        ? rawSched
        : { weekday: true, weekend: false }; // default = weekday

    // 3) Выбираем флаг для clash-check
    const flagKey: 'weekday' | 'weekend' = schedule.weekend ? 'weekend' : 'weekday';

    // 4) Смотрим, нет ли уже такой записи
    const existing = await prisma.sub_merchant.findMany({
      where: { merchantId, provider },
      select: { schedule: true },
    });

    const clash = existing.some(
      s => (s.schedule as any)[flagKey] === true
    );
    if (clash) {
      return res.status(400).json({
        error: `Sudah ada ${provider} credential untuk ${flagKey}`,
      });
    }

    // 5) Сохраняем
    const created = await prisma.sub_merchant.create({
      data: {
        merchant:   { connect: { id: merchantId } },
        provider,
        name,
        credentials,           // Prisma: Json
        schedule,              // Prisma: Json
        fee: fee != null ? Number(fee) : 0,
      },
    });

    return res.status(201).json(created);
  } catch (err: any) {
    console.error('[connectPG]', err);
    return res
      .status(500)
      .json({ error: 'Gagal connect PG, silakan coba lagi nanti.' });
  }
};
// 8. List koneksi PG untuk satu merchant
export const listPGs = async (req: Request, res: Response) => {
  const merchantId = req.params.id;
  const list = await prisma.sub_merchant.findMany({
    where: { merchantId },
  });
  res.json(list);
};

// 9. Update fee koneksi PG
export const updatePGFee = async (req: Request, res: Response) => {
   try {
     const merchantId = req.params.id
    const subId       = req.params.subId
    const { provider, credentials, fee, name, schedule: rawSched } = req.body

    // 1) Pastikan record ada dan milik merchant yang sama
    const existing = await prisma.sub_merchant.findUnique({
      where: { id: subId },
      select: { merchantId: true }
    })
    if (!existing) {
      return res.status(404).json({ error: 'Sub-merchant tidak ditemukan.' })
    }
    if (existing.merchantId !== merchantId) {
      return res.status(403).json({ error: 'Akses ditolak.' })
    }

    // 2) Build objek `data` hanya dari field yang dikirim
    const data: any = {}
    if (provider) {
      data.provider = provider
    }
    if (name) {
      data.name = name
    }
    if (credentials?.merchantId && credentials?.secretKey) {
      data.credentials = credentials
    }
    if (typeof fee !== 'undefined') {
      data.fee = Number(fee)
    }
    if (
      rawSched &&
      typeof rawSched.weekday === 'boolean' &&
      typeof rawSched.weekend === 'boolean'
    ) {
      data.schedule = rawSched
    }

    // 3) Lakukan update
    const updated = await prisma.sub_merchant.update({
      where: { id: subId },
      data,
    })

    return res.json(updated)
  } catch (err: any) {
    console.error('[updateSubMerchant]', err)
    return res
      .status(500)
      .json({ error: 'Gagal memperbarui koneksi PG, silakan coba lagi nanti.' })
  }
}

// 10. Disconnect PG
export const disconnectPG = async (req: Request, res: Response) => {
  const subId = req.params.subId;
  await prisma.sub_merchant.delete({ where: { id: subId } });
  res.status(204).end();
};

// 11. Regenerate API key untuk partnerClient
export const regenerateApiKey = async (_req: Request, res: Response) => {
  const apiKey = uuid();
  const apiSecret = uuid();
  const client = await prisma.partnerClient.create({
    data: {
      name: `Client-${apiKey}`,
      apiKey,
      apiSecret,
      isActive: true,
    },
  });
  res.json({ apiKey: client.apiKey, apiSecret: client.apiSecret });
};
export async function getDashboardTransactions(req: Request, res: Response) {
  try {
    // (1) parse tanggal & merchant filter
    const {
      date_from,
      date_to,
      partnerClientId,
      page = '1',
      limit = '50',
      status,
      search
        } = req.query as any
    const pageNum = Math.max(1, parseInt(page as string, 10))
    const pageSize = Math.min(100, parseInt(limit as string, 10))
    const dateFrom = date_from ? new Date(String(date_from)) : undefined
    const dateTo   = date_to   ? new Date(String(date_to))   : undefined
    const searchStr = typeof search === 'string' ? search.trim() : ''

    const createdAtFilter: any = {}
    if (dateFrom && !isNaN(dateFrom.getTime())) createdAtFilter.gte = dateFrom
    if (dateTo   && !isNaN(dateTo.getTime()))   createdAtFilter.lte = dateTo
    const allowedStatuses = [
      'SUCCESS',
      'DONE',
      'SETTLED',
      'PAID',
      'PENDING',
      'EXPIRED'
    ] as const
    let statusList: string[] | undefined
    if (status !== undefined) {
      const arr = Array.isArray(status) ? status : [status]
      if (!arr.every((s) => allowedStatuses.includes(String(s) as any))) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      statusList = arr.map(String)
            if (statusList.includes('SUCCESS') && !statusList.includes('SETTLED')) {
        statusList.push('SETTLED')
      }
      statusList = Array.from(new Set(statusList))
    }

    // (2) build where untuk orders
    const whereOrders: any = {
      ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
    }
    if (statusList) {
      whereOrders.status = { in: statusList }
    } else {
      whereOrders.status = { in: allowedStatuses as any }
    }
    if (partnerClientId && partnerClientId !== 'all') {
      whereOrders.partnerClientId = partnerClientId
    }

    // (3) total pending
    const pendingAgg = await prisma.order.aggregate({
      _sum: { pendingAmount: true },
      where: { ...whereOrders, status: 'PAID' }
    })
    const totalPending = pendingAgg._sum.pendingAmount ?? 0

    // (4) active balance via settled
    const settleAgg = await prisma.order.aggregate({
      _sum: { settlementAmount: true },
      where: { ...whereOrders, status: { in: ['SUCCESS', 'DONE', 'SETTLED'] } }
    })
    const ordersActiveBalance = settleAgg._sum.settlementAmount ?? 0
    // (4.1) total paid (SUM(amount) status = 'PAID' tanpa limit)
    const paidAgg = await prisma.order.aggregate({
      _sum: { amount: true },
      where: { ...whereOrders, status: 'PAID' }
    })
    const totalPaid = paidAgg._sum.amount ?? 0
    // (5) merchant total balance
    const pcWhere: any = {}
    if (partnerClientId && partnerClientId !== 'all') {
      pcWhere.id = partnerClientId
    }
        if (searchStr) {
      whereOrders.OR = [
        { id:       { contains: searchStr, mode: 'insensitive' } },
        { rrn:      { contains: searchStr, mode: 'insensitive' } },
        { playerId: { contains: searchStr, mode: 'insensitive' } },
      ]
    }
    const partnerClients = await prisma.partnerClient.findMany({
      where: pcWhere,
      select: { balance: true }
    })
    const totalMerchantBalance = partnerClients
      .reduce((sum, pc) => sum + pc.balance, 0)

    // (6) ambil detail orders, termasuk ketiga timestamp
      const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: whereOrders,
        orderBy: { createdAt: 'desc' },
        ...(searchStr ? {} : {
          skip:  (pageNum - 1) * pageSize,
          take:  pageSize,
        }),
        select: {
          id:                   true,
          createdAt:            true,
          playerId:             true,
          qrPayload:            true,
          rrn:                  true,
          amount:               true,
          feeLauncx:            true,
          fee3rdParty:          true,
          pendingAmount:        true,
          settlementAmount:     true,
          status:               true,
          settlementStatus:     true,
          channel:              true,
          paymentReceivedTime:  true,  // ← baru
          settlementTime:       true,  // ← baru
          trxExpirationTime:    true,  // ← barus
        }
      }),
      prisma.order.count({ where: whereOrders })
    ])
    // (7) map ke format FE, include netSettle + timestamp ISO
    const transactions = orders.map(o => {
      const pend = o.pendingAmount    ?? 0
      const sett = o.settlementAmount ?? 0
      const netSettle = o.status === 'PAID' ? pend : sett

      return {
        id:                   o.id,
        date:                 o.createdAt.toISOString(),
        reference:            o.qrPayload   ?? '',
        rrn:                  o.rrn         ?? '',
        playerId:             o.playerId,
        amount:               o.amount,
        feeLauncx:            o.feeLauncx   ?? 0,
        feePg:                o.fee3rdParty ?? 0,
        netSettle,
        status:               o.status === 'SETTLED' ? 'SUCCESS' : o.status,
        settlementStatus:     o.settlementStatus ?? '',
        channel:              o.channel     ?? '',
        // tiga timestamp baru:
        paymentReceivedTime:  o.paymentReceivedTime
                               ? o.paymentReceivedTime.toISOString()
                               : '',
        settlementTime:       o.settlementTime
                               ? o.settlementTime.toISOString()
                               : '',
        trxExpirationTime:    o.trxExpirationTime
                               ? o.trxExpirationTime.toISOString()
                               : '',
      }
    })

   // (8) kembalikan JSON, sekarang dengan totalPaid terpisah
    return res.json({
     transactions,
      total,                  // jumlah row (untuk paging)
      totalPaid,              // total nominal semua transaksi PAID
      totalPending,
      ordersActiveBalance,
      totalMerchantBalance
    })
  } catch (err: any) {
    console.error('[getDashboardTransactions]', err)
    return res.status(500).json({ error: 'Failed to fetch dashboard transactions' })
  }
}


export async function getDashboardWithdrawals(req: Request, res: Response) {
  try {
    // (1) Parse filter tanggal & partnerClientId
    const { date_from, date_to, partnerClientId, page = '1', limit = '50' } =
      req.query as any;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const pageSize = Math.min(100, parseInt(limit as string, 10));    const dateFrom = date_from ? new Date(String(date_from)) : undefined;
    const dateTo   = date_to   ? new Date(String(date_to))   : undefined;
    const createdAtFilter: any = {};
    if (dateFrom && !isNaN(dateFrom.getTime())) createdAtFilter.gte = dateFrom;
    if (dateTo   && !isNaN(dateTo.getTime()))   createdAtFilter.lte = dateTo;

    // (2) Build where untuk withdrawRequest
    const where: any = {};
    if (partnerClientId && partnerClientId !== 'all') {
      where.partnerClientId = partnerClientId;
    }
    if (dateFrom || dateTo) {
      where.createdAt = createdAtFilter;
    }
 
    // (3) Ambil data dari DB, select semua kolom yang diperlukan
   const [rows, total] = await Promise.all([
      prisma.withdrawRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
        select: {
          id:                true,
          refId:             true,
          accountName:       true,
          accountNameAlias:  true,
          accountNumber:     true,
          bankCode:          true,
          bankName:          true,
          branchName:        true,
          amount:            true,
          netAmount:         true,
          pgFee:            true,

          paymentGatewayId:  true,
          isTransferProcess: true,
          status:            true,
          createdAt:         true,
          completedAt:       true,
          withdrawFeePercent: true,
          withdrawFeeFlat:    true,
          subMerchant: { select: { name: true, provider: true } },
        },
      }),
      prisma.withdrawRequest.count({ where }),
    ])
    // (4) Format & kirim
    const data = rows.map(w => ({
      id:                w.id,
      refId:             w.refId,
      accountName:       w.accountName,
      accountNameAlias:  w.accountNameAlias,
      accountNumber:     w.accountNumber,
      bankCode:          w.bankCode,
      bankName:          w.bankName,
      branchName:        w.branchName ?? null,
      amount:            w.amount,
      netAmount:         w.netAmount ?? null,
      pgFee:            w.pgFee ?? null,
      withdrawFeePercent: w.withdrawFeePercent,
      withdrawFeeFlat:    w.withdrawFeeFlat,
      paymentGatewayId:  w.paymentGatewayId ?? null,
      isTransferProcess: w.isTransferProcess,
      status:            w.status,
      createdAt:         w.createdAt.toISOString(),
      completedAt:       w.completedAt?.toISOString() ?? null,
      wallet:            w.subMerchant?.name || w.subMerchant?.provider,

    }));

    return res.json({ data, total });
  } catch (err: any) {
    console.error('[getDashboardWithdrawals]', err);
    return res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
}

export const getProfitPerSubMerchant = async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, merchantId } = req.query as any;

    // 1. Filter dasar: hanya transaksi SETTLED
    const where: any = { status: 'SETTLED' };

    // 2. Filter tanggal menggunakan createdAt
    if (date_from) {
      where.createdAt = { gte: new Date(date_from) };
    }
    if (date_to) {
      where.createdAt = {
        ...(where.createdAt || {}),
        lte: new Date(date_to)
      };
    }

    // 3. Filter merchant jika diberikan
    if (merchantId && merchantId !== 'all') {
      where.merchantId = merchantId;
    }

    // 4. Group by subMerchantId dan hitung total profit per group
    const grouped = await prisma.order.groupBy({
      by: ['subMerchantId'],
      where,
      _sum: {
        feeLauncx: true,
        fee3rdParty: true
      }
    });

    // 5. Ambil nama sub-merchant jika ada
    const ids = grouped.map(g => g.subMerchantId).filter(Boolean);
    const subs = await prisma.sub_merchant.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true }
    });
    const nameMap: Record<string, string> = {};
    subs.forEach(s => { nameMap[s.id] = s.name; });

    const data = grouped.map(g => ({
      subMerchantId: g.subMerchantId,
      name: nameMap[g.subMerchantId] || null,
      profit: (g._sum.feeLauncx ?? 0) - (g._sum.fee3rdParty ?? 0)
    }));

    return res.json({ data });
  } catch (err: any) {
    console.error('[getProfitPerSubMerchant]', err);
    return res.status(500).json({ error: err.message });
  }
};
// src/controller/admin/merchant.controller.ts
export const getDashboardSummary = async (req: Request, res: Response) => {
  try {
    const { partnerClientId, merchantId, date_from, date_to } = req.query as any;

    const dateFrom = date_from ? new Date(String(date_from)) : undefined;
    const dateTo   = date_to   ? new Date(String(date_to))   : undefined;
    const createdAtFilter: any = {};
    if (dateFrom && !isNaN(dateFrom.getTime())) createdAtFilter.gte = dateFrom;
    if (dateTo   && !isNaN(dateTo.getTime()))   createdAtFilter.lte = dateTo;
    // 1) Hitung hari ini: weekend vs weekday (termasuk override)
    const isWeekend = isJakartaWeekend(new Date())
    const scheduleFilter = isWeekend
      ? { weekday: false, weekend: true }
      : { weekday: true, weekend: false };

    // ─── 2) Sub-Merchant Balances ─────────────────────────────
    let total_withdrawal = 0, pending_withdrawal = 0

    const subs = await prisma.sub_merchant.findMany({
      where: {
        merchantId,
        provider: { in: ['hilogate', 'oy'] },
      },
      select: { id: true, name: true, provider: true, credentials: true }
    })

    const balanceResults = await Promise.all(subs.map(async (s) => {
      let bal = 0
            let wdTotal: number | undefined
      let wdPending: number | undefined
      try {
        if (s.provider === 'hilogate') {
          const raw = s.credentials as any
          const cfg: HilogateConfig = {
            merchantId: raw.merchantId,
            env:        raw.env,
            secretKey:  raw.secretKey,
          }
          const client = new HilogateClient(cfg)
          const resp   = await client.getBalance()
          const data   = resp.data
          bal = data.active_balance ?? 0
          wdTotal   = data.total_withdrawal
          wdPending = data.pending_withdrawal
        } else if (s.provider === 'oy') {
          const raw = s.credentials as any
          const cfg: OyConfig = {
            baseUrl:  config.api.oy.baseUrl,
            username: raw.merchantId,
            apiKey:   raw.secretKey,
          }
          const client = new OyClient(cfg)
          const resp   = await client.getBalance()
          const data   = (resp as any).data ?? resp
          bal = data.availableBalance ?? data.balance ?? 0
        }
      } catch (e) {

        console.error(`[${s.provider}] getBalance error`, e)
              }
      return { id: s.id, name: s.name, provider: s.provider, balance: bal, wdTotal, wdPending }
    }))

    const subBalances = balanceResults.map(r => ({
      id:       r.id,
      name:     r.name,
      provider: r.provider,
      balance:  r.balance
    }))

    for (const r of balanceResults) {
      if (r.wdTotal != null && total_withdrawal === 0 && pending_withdrawal === 0) {
        total_withdrawal   = r.wdTotal ?? 0
        pending_withdrawal = r.wdPending ?? 0
      }
    }

     // ─── 3) Aggregate orders & withdrawals ───────────────────
    const whereOrders: any = {};
    if (partnerClientId && partnerClientId !== 'all') {
      whereOrders.partnerClientId = partnerClientId;
    }
    if (dateFrom || dateTo) {
      whereOrders.createdAt = createdAtFilter;
    }

const successStatuses = ['PAID', 'DONE', 'SETTLED', 'SUCCESS'];
const tpvAgg = await prisma.order.aggregate({
  _sum: { amount: true },
  where: {
    ...whereOrders,
    status: { in: successStatuses },
  },
});

    const paidAgg = await prisma.order.aggregate({
      _sum: { amount: true },
      where: { ...whereOrders, status: 'PAID' },
    });
    const settleAgg = await prisma.order.aggregate({
      _sum: { settlementAmount: true },
      where: { ...whereOrders, status: { in: ['SUCCESS', 'DONE', 'SETTLED'] } },
    });

    const whereWd: any = { status: DisbursementStatus.COMPLETED };
    if (partnerClientId && partnerClientId !== 'all') {
      whereWd.partnerClientId = partnerClientId;
    }
    if (dateFrom || dateTo) {
      whereWd.createdAt = createdAtFilter;
    }
    const succWdAgg = await prisma.withdrawRequest.aggregate({
      _sum: { amount: true },
      where: whereWd,
    });

    const totalAvailableWithdraw = total_withdrawal - pending_withdrawal;
    // ─── 4) Total Client Balance ────────────────────────
    let clientIds: string[] | undefined
    if (partnerClientId && partnerClientId !== 'all') {
      clientIds = [partnerClientId]

    } else {
      const list = await prisma.partnerClient.findMany({
        where: { isActive: true },
        select: { id: true }
      })
      clientIds = list.map(c => c.id)
    }
    const subIds = subs.map(s => s.id)

    const inAgg = await prisma.order.aggregate({
      _sum: { settlementAmount: true },
      where: {
        partnerClientId: { in: clientIds },
        subMerchantId:   { in: subIds },
        settlementTime:  { not: null }
      }
    })

    const outAgg = await prisma.withdrawRequest.aggregate({
      _sum: { amount: true },
      where: {
        partnerClientId: { in: clientIds },
        subMerchantId:   { in: subIds },
        status: { in: [DisbursementStatus.PENDING, DisbursementStatus.COMPLETED] }
      }
    })

    const totalClientBalance =
      (inAgg._sum.settlementAmount ?? 0) - (outAgg._sum.amount ?? 0)
    // ─── 5) Kirim response ───────────────────────────────
    return res.json({
      subBalances,
      total_withdrawal,
      pending_withdrawal,
      totalClientBalance,
      totalPaymentVolume: tpvAgg._sum.amount ?? 0,
      totalPaid:          paidAgg._sum.amount ?? 0,
      totalSettlement:    settleAgg._sum.settlementAmount ?? 0,
      totalAvailableWithdraw,
      totalSuccessfulWithdraw: succWdAgg._sum.amount ?? 0,
    })

  } catch (err: any) {
    console.error('[getDashboardSummary]', err);
    return res
      .status(500)
      .json({ error: err.message || 'Failed to fetch dashboard summary' });
  }
};

export async function exportDashboardAll(req: Request, res: Response) {
  try {
    const { date_from, date_to, partnerClientId, status } = req.query as any
    const dateFrom = parseDateSafely(date_from)
    const dateTo   = parseDateSafely(date_to)
    const createdAtFilter: any = {}
    if (dateFrom) createdAtFilter.gte = dateFrom
    if (dateTo)   createdAtFilter.lte = dateTo

    // ▶ REVISI #1: Izinkan semua kemungkinan status
    const allowedStatuses = [
      'SUCCESS',
      'DONE',
      'SETTLED',
      'PAID',
      'PENDING',
      'EXPIRED',
    ] as const

    // ▶ REVISI #2: Bangun statusList dan tambahkan mapping khusus
    let statusList: string[] | undefined
    if (status !== undefined) {
      const arr = Array.isArray(status) ? status : [status]
      if (!arr.every((s) => allowedStatuses.includes(String(s) as any))) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      statusList = arr.map(String)

      // ▶ REVISI: kalau user pilih 'SUCCESS', sertakan 'SETTLED'
      if (statusList.includes('SUCCESS') && !statusList.includes('SETTLED')) {
        statusList.push('SETTLED')
      }
      // ▶ REVISI: kalau user pilih 'PAID', sertakan 'DONE'
      if (statusList.includes('PAID') && !statusList.includes('DONE')) {
        statusList.push('DONE')
      }

      // hilangkan duplikat
      statusList = Array.from(new Set(statusList))
    }

    // ▶ REVISI #3: Terapkan ke whereOrders
    const whereOrders: any = {
      ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
    }
    if (statusList) {
      whereOrders.status = { in: statusList }   // ▶ REVISI
    } else {
      // ▶ REVISI: default mencakup SEMUA status
      whereOrders.status = { in: allowedStatuses }
    }
    if (partnerClientId && partnerClientId !== 'all') {
      whereOrders.partnerClientId = partnerClientId
    }

    // Fetch orders
    const CHUNK_SIZE = 1000

    // Prepare workbook stream
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="dashboard-all.xlsx"')

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res })

    // Sheet 1: Transactions
    const txSheet = wb.addWorksheet('Transactions')
    txSheet.addRow([
      'Date','TRX ID','RRN','Player ID','Channel',
      'Amount','Fee Launcx','Fee PG','Net Amount','Status'
    ]).commit()

    let skipOrders = 0
    for (;;) {
      const ordersChunk = await prisma.order.findMany({
        where: whereOrders,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          id: true,
          rrn: true,
          playerId: true,
          channel: true,
          amount: true,
          feeLauncx: true,
          fee3rdParty: true,
          pendingAmount: true,
          settlementAmount: true,
          status: true
        },
        take: CHUNK_SIZE,
        skip: skipOrders,
      })

      for (const o of ordersChunk) {
        const net = o.status === 'PAID' ? o.pendingAmount : o.settlementAmount
        txSheet.addRow([
          formatDateJakarta(o.createdAt),
          o.id,
          o.rrn,
          o.playerId,
          o.channel,
          o.amount,
          o.feeLauncx,
          o.fee3rdParty,
          net,
          o.status
        ]).commit()
      }
      skipOrders += ordersChunk.length
      if (ordersChunk.length < CHUNK_SIZE) break
    }

    // Build withdrawal filter
    const whereWD: any = {}
    if (partnerClientId && partnerClientId !== 'all') {
      whereWD.partnerClientId = partnerClientId
    }
    if (dateFrom || dateTo) {
      whereWD.createdAt = createdAtFilter
    }

    // Fetch withdrawals
    const withdrawals = await prisma.withdrawRequest.findMany({
      where: whereWD,
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        refId: true,
        bankName: true,
        accountNumber: true,
        amount: true,
        netAmount: true,
        withdrawFeePercent: true,
        withdrawFeeFlat: true,
        pgFee: true,
        status: true
      }
    })

    // Sheet 2: Withdrawals
    const wdSheet = wb.addWorksheet('Withdrawals')
    wdSheet.addRow([
      'Date','Ref ID','Bank','Account',
      'Amount','Withdrawal Fee','PG Fee','Status'
    ]).commit()

    let skipWD = 0
    for (;;) {
      const withdrawalsChunk = await prisma.withdrawRequest.findMany({
        where: whereWD,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          refId: true,
          bankName: true,
          accountNumber: true,
          amount: true,
          netAmount: true,
          withdrawFeePercent: true,
          withdrawFeeFlat: true,
          pgFee: true,
          status: true
        },
        take: CHUNK_SIZE,
        skip: skipWD,
      })

      for (const w of withdrawalsChunk) {
        const wdFee = w.netAmount != null
          ? w.amount - w.netAmount
          : (w.withdrawFeePercent / 100) * w.amount + w.withdrawFeeFlat
        wdSheet.addRow([
          formatDateJakarta(w.createdAt),
          w.refId,
          w.bankName,
          w.accountNumber,
          w.amount,
          wdFee,
          w.pgFee ?? 0,
          w.status
        ]).commit()
      }
      skipWD += withdrawalsChunk.length
      if (withdrawalsChunk.length < CHUNK_SIZE) break
    }

    await wb.commit()
    res.end()
  } catch (err: any) {
    console.error('[exportDashboardAll]', err)
    res.status(500).json({ error: 'Failed to export data' })
  }
}

export const getPlatformProfit = async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, merchantId } = req.query as any;

    // 1. Filter status
    const where: any = { status: 'SETTLED' };

    // 2. Pakai createdAt sebagai filter tanggal
    if (date_from) {
      where.createdAt = { gte: new Date(date_from) };
    }
    if (date_to) {
      where.createdAt = {
        ...(where.createdAt || {}),
        lte: new Date(date_to)
      };
    }
    if (merchantId && merchantId !== 'all') {
      where.merchantId = merchantId;
    }

    // 3. Ambil feeLauncx & fee3rdParty
    const profitTxs = await prisma.order.findMany({
      where,
      select: { feeLauncx: true, fee3rdParty: true }
    });

    // 4. Hitung totalProfit
    const totalProfit = profitTxs.reduce((sum, t) => {
      return sum + ((t.feeLauncx ?? 0) - (t.fee3rdParty ?? 0));
    }, 0);

    return res.json({ totalProfit });
  } catch (err: any) {
    console.error('[getPlatformProfit]', err);
    return res.status(500).json({ error: err.message });
  }
};