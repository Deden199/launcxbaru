import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto'
import axios from 'axios'
import {HilogateClient ,HilogateConfig} from '../../service/hilogateClient'
import ExcelJS from 'exceljs'
import {OyClient,OyConfig}          from '../../service/oyClient'    // sesuaikan path
import { config } from '../../config';


const prisma = new PrismaClient();

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
    const { date_from, date_to, partnerClientId } = req.query as any
    const dateFrom = date_from ? new Date(String(date_from)) : undefined
    const dateTo   = date_to   ? new Date(String(date_to))   : undefined
    const createdAtFilter: any = {}
    if (dateFrom && !isNaN(dateFrom.getTime())) createdAtFilter.gte = dateFrom
    if (dateTo   && !isNaN(dateTo.getTime()))   createdAtFilter.lte = dateTo

    // (2) build where untuk orders
    const whereOrders: any = {
      status: {
        in: [
          'SUCCESS',
          'DONE',
          'SETTLED',
          'PAID',
          'PENDING',
          'EXPIRED'
        ],
      },      ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {}),
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

    // (5) merchant total balance
    const pcWhere: any = {}
    if (partnerClientId && partnerClientId !== 'all') {
      pcWhere.id = partnerClientId
    }
    const partnerClients = await prisma.partnerClient.findMany({
      where: pcWhere,
      select: { balance: true }
    })
    const totalMerchantBalance = partnerClients
      .reduce((sum, pc) => sum + pc.balance, 0)

    // (6) ambil detail orders, termasuk ketiga timestamp
    const orders = await prisma.order.findMany({
      where: whereOrders,
      orderBy: { createdAt: 'desc' },
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
    })

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

    // (8) kembalikan JSON
    return res.json({
      transactions,
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
    const { date_from, date_to, partnerClientId } = req.query as any;
    const dateFrom = date_from ? new Date(String(date_from)) : undefined;
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
    const rows = await prisma.withdrawRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
        paymentGatewayId:  true,
        isTransferProcess: true,
        status:            true,
        createdAt:         true,
        completedAt:       true,
      },
    });

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
      paymentGatewayId:  w.paymentGatewayId ?? null,
      isTransferProcess: w.isTransferProcess,
      status:            w.status,
      createdAt:         w.createdAt.toISOString(),
      completedAt:       w.completedAt?.toISOString() ?? null,
    }));

    return res.json({ data });
  } catch (err: any) {
    console.error('[getDashboardWithdrawals]', err);
    return res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
}


// src/controller/admin/merchant.controller.ts
export const getDashboardSummary = async (req: Request, res: Response) => {
  try {
    const { partnerClientId, merchantId } = req.query as any;

    // 1) Hitung hari ini: weekend vs weekday
    const day = new Date().getDay(); // 0=Minggu,6=Sabtu
    const isWeekend = day === 0 || day === 6;
    const scheduleFilter = isWeekend
      ? { weekday: false, weekend: true }
      : { weekday: true, weekend: false };

    // ─── 2) HILOGATE ────────────────────────────────────
    let hilogateBalance = 0, total_withdrawal = 0, pending_withdrawal = 0;
    try {
      const hgSubs = await prisma.sub_merchant.findMany({
        where: {
          merchantId,
          provider: 'hilogate',
          schedule: { equals: scheduleFilter },
        }
      });
      if (hgSubs.length) {
        const raw = hgSubs[0].credentials as any;
        const cfg: HilogateConfig = {
          merchantId: raw.merchantId,
          env:        raw.env,
          secretKey:  raw.secretKey,
        };
        const client = new HilogateClient(cfg);
        const resp = await client.getBalance();
        const data = resp.data;
        hilogateBalance   = data.active_balance   ?? 0;
        total_withdrawal   = data.total_withdrawal ?? 0;
        pending_withdrawal = data.pending_withdrawal ?? 0;
      }
    } catch (e) {
      console.error('[HILOGATE] getBalance error', e);
    }

    // ─── 3) OY ───────────────────────────────────────
   let oyBalance = 0;
try {
  const oySubs = await prisma.sub_merchant.findMany({
    where: {
      merchantId,
      provider: 'oy',
      schedule: { equals: scheduleFilter },
    },
  });
  if (oySubs.length) {
    const raw = oySubs[0].credentials as any;

    // Ambil baseUrl dari config, bukan dari raw.env
    const cfg: OyConfig = {
      baseUrl:  config.api.oy.baseUrl,  
      username: raw.merchantId,
      apiKey:   raw.secretKey,
    };

    const client = new OyClient(cfg);
    const resp   = await client.getBalance();
    const data   = (resp as any).data ?? resp;
    oyBalance    = data.availableBalance ?? data.balance ?? 0;
  }
} catch (e) {
  console.error('[OY] getBalance error', e);
}
    // ─── 4) Total Client Balance ────────────────────────
    let totalClientBalance = 0;
    if (partnerClientId && partnerClientId !== 'all') {
      const pc = await prisma.partnerClient.findUnique({
        where: { id: partnerClientId },
        select: { balance: true },
      });
      totalClientBalance = pc?.balance ?? 0;
    } else {
      const agg = await prisma.partnerClient.aggregate({
        _sum: { balance: true },
        where: { isActive: true }
      });
      totalClientBalance = agg._sum.balance ?? 0;
    }

    // ─── 5) Kirim response ───────────────────────────────
    return res.json({
      hilogateBalance,
      total_withdrawal,
      pending_withdrawal,
      oyBalance,
      totalClientBalance,
    });

  } catch (err: any) {
    console.error('[getDashboardSummary]', err);
    return res
      .status(500)
      .json({ error: err.message || 'Failed to fetch dashboard summary' });
  }
};

export async function exportDashboardAll(req: Request, res: Response) {
  try {
    const { date_from, date_to, partnerClientId } = req.query as any
    const dateFrom = date_from ? new Date(String(date_from)) : undefined
    const dateTo   = date_to   ? new Date(String(date_to))   : undefined
    const createdAtFilter: any = {}
    if (dateFrom) createdAtFilter.gte = dateFrom
    if (dateTo)   createdAtFilter.lte = dateTo

    // Build order filter
    const whereOrders: any = {
      status: { in: ['SUCCESS','DONE','SETTLED','PAID'] },
      ...(dateFrom||dateTo ? { createdAt: createdAtFilter } : {})
    }
    if (partnerClientId && partnerClientId !== 'all') {
      whereOrders.partnerClientId = partnerClientId
    }

    // Fetch orders
    const orders = await prisma.order.findMany({
      where: whereOrders,
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true, id: true, rrn: true, playerId: true, channel: true,
        amount: true, feeLauncx: true, fee3rdParty: true,
        pendingAmount: true, settlementAmount: true, status: true
      }
    })

    // Build withdrawal filter
    const whereWD: any = {}
    if (partnerClientId && partnerClientId !== 'all') {
      whereWD.partnerClientId = partnerClientId
    }
    if (dateFrom||dateTo) {
      whereWD.createdAt = createdAtFilter
    }

    // Fetch withdrawals
    const withdrawals = await prisma.withdrawRequest.findMany({
      where: whereWD,
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, refId: true, bankName: true, accountNumber: true, amount: true, status: true }
    })

    // Prepare workbook
    const wb = new ExcelJS.Workbook()
    // Sheet 1: Transactions
    const txSheet = wb.addWorksheet('Transactions')
    txSheet.addRow(['Date','TRX ID','RRN','Player ID','Channel','Amount','Fee Launcx','Fee PG','Net Amount','Status'])
    orders.forEach(o => {
      const net = o.status === 'PAID' ? o.pendingAmount : o.settlementAmount
      txSheet.addRow([
        o.createdAt.toISOString(), o.id, o.rrn, o.playerId, o.channel,
        o.amount, o.feeLauncx, o.fee3rdParty, net, o.status
      ])
    })

    // Sheet 2: Withdrawals
    const wdSheet = wb.addWorksheet('Withdrawals')
    wdSheet.addRow(['Date','Ref ID','Bank','Account','Amount','Status'])
    withdrawals.forEach(w => {
      wdSheet.addRow([
        w.createdAt.toISOString(), w.refId, w.bankName, w.accountNumber, w.amount, w.status
      ])
    })

    // Response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="dashboard-all.xlsx"')

    await wb.xlsx.write(res)
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