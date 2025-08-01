// src/controllers/clientDashboard.controller.ts

import { Response } from 'express'
import { prisma } from '../core/prisma'
import { DisbursementStatus } from '@prisma/client'
import { ClientAuthRequest } from '../middleware/clientAuth'
import ExcelJS from 'exceljs'
import crypto from 'crypto';
import axios from 'axios';
import { formatDateJakarta } from '../util/time';
import pLimit from 'p-limit' // optional kalau mau throttle paralel, tapi tidak diperlukan

import { retry } from '../utils/retry';
import { CALLBACK_ALLOWED_STATUSES, isCallbackStatusAllowed } from '../utils/callbackStatus';

const DASHBOARD_STATUSES = [
  'SUCCESS',
  'DONE',
  'SETTLED',
  'PAID',
  'PENDING',      // <<< REVISI: tambahkan biar order PENDING ikut ter-fetch
  'EXPIRED',      // <<< REVISI: tambahkan biar order EXPIRED ikut ter-fetch
  // …tambahkan status lain jika ada…
];



export async function getClientCallbackUrl(req: ClientAuthRequest, res: Response) {
  // Cari clientUser untuk dapatkan partnerClientId
  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    select: { partnerClientId: true },
  })
  if (!user) {
    return res.status(404).json({ error: 'User tidak ditemukan' })
  }

  // Ambil data callback dari partnerClient
  const partner = await prisma.partnerClient.findUnique({
    where: { id: user.partnerClientId },
    select: { callbackUrl: true, callbackSecret: true },
  })
  if (!partner) {
    return res.status(404).json({ error: 'PartnerClient tidak ditemukan' })
  }

  return res.json({
    callbackUrl:    partner.callbackUrl || '',
    callbackSecret: partner.callbackSecret || '',
  })
}

/**
 * POST /api/v1/client/callback-url
 * Body: { callbackUrl: string }
 * – Update callbackUrl dan hasilkan callbackSecret jika belum ada
 */
export async function updateClientCallbackUrl(req: ClientAuthRequest, res: Response) {
  const { callbackUrl } = req.body

  // Validasi format HTTPS
  if (typeof callbackUrl !== 'string' || !/^https:\/\/.+/.test(callbackUrl)) {
    return res.status(400).json({ error: 'Callback URL harus HTTPS' })
  }

  // Dapatkan partnerClientId
  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    select: { partnerClientId: true },
  })
  if (!user) {
    return res.status(404).json({ error: 'User tidak ditemukan' })
  }

  // Generate callbackSecret jika terkirim pertama
  const existing = await prisma.partnerClient.findUnique({
    where: { id: user.partnerClientId },
    select: { callbackSecret: true },
  })
  let secret = existing?.callbackSecret
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
  }

  // Simpan callbackUrl & callbackSecret
  const updated = await prisma.partnerClient.update({
    where: { id: user.partnerClientId },
    data: { callbackUrl, callbackSecret: secret },
    select: { callbackUrl: true, callbackSecret: true },
  })

  return res.json({
    callbackUrl:    updated.callbackUrl,
    callbackSecret: updated.callbackSecret,
  })
}
export async function getClientDashboard(req: ClientAuthRequest, res: Response) {
  try {
    // (1) ambil user + partnerClient + children (termasuk balance)
    const user = await prisma.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          select: {
            id: true,
            name: true,
            balance: true,
            children: {
              select: {
                id: true,
                name: true,
                balance: true
              }
            }
          }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    const pc = user.partnerClient!;

    // (2) parse tanggal
    const dateFrom = req.query.date_from ? new Date(String(req.query.date_from)) : undefined;
    const dateTo   = req.query.date_to   ? new Date(String(req.query.date_to))   : undefined;
    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) createdAtFilter.gte = dateFrom;
    if (dateTo)   createdAtFilter.lte = dateTo;

// (2b) parse status filter (dipakai untuk totalTransaksi)
const rawStatus = (req.query as any).status;
const allowed = DASHBOARD_STATUSES as readonly string[];
let statuses: string[] = [];

if (Array.isArray(rawStatus)) {
  statuses = rawStatus
    .map(String)
    .flatMap(s => (s === 'SUCCESS' ? ['SUCCESS', 'DONE', 'SETTLED'] : [s]))
    .filter(s => allowed.includes(s));
} else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
  statuses = rawStatus
    .split(',')
    .map(s => s.trim())
    .flatMap(s => (s === 'SUCCESS' ? ['SUCCESS', 'DONE', 'SETTLED'] : [s]))
    .filter(s => allowed.includes(s));
}

if (statuses.length === 0) statuses = [...allowed];

    // (2c) pagination params
    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, parseInt(String(req.query.limit || '50'), 10));

    // (2d) search keyword
    const searchStr = typeof req.query.search === 'string'
      ? req.query.search.trim()
      : '';

    // (3) build list of IDs to query
    let clientIds: string[];
    if (typeof req.query.clientId === 'string'
        && req.query.clientId !== 'all'
        && req.query.clientId.trim()) {
      clientIds = [req.query.clientId];
    } else if (pc.children.length > 0) {
      clientIds = [pc.id, ...pc.children.map(c => c.id)];
    } else {
      clientIds = [pc.id];
    }

    // (4a) total pending seperti sebelumnya
    const pendingAgg = await prisma.order.aggregate({
      _sum: { pendingAmount: true },
      where: {
        partnerClientId: { in: clientIds },
        status: 'PAID',
        ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
      }
    });
    const totalPending = pendingAgg._sum.pendingAmount ?? 0;

    // (4b) HITUNG TOTAL ACTIVE BALANCE BERDASARKAN clientIds
    const parentBal = clientIds.includes(pc.id) ? pc.balance ?? 0 : 0;
    const childrenBal = pc.children
      .filter(c => clientIds.includes(c.id))
      .reduce((sum, c) => sum + (c.balance ?? 0), 0);
    const totalActive = parentBal + childrenBal;

    // (4c) ambil transaksi + total untuk pagination + search
    const whereOrders: any = {
      partnerClientId: { in: clientIds },
      status: { in: statuses },
      ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
    };
    if (searchStr) {
      whereOrders.OR = [
        { id:       { contains: searchStr, mode: 'insensitive' } },
        { rrn:      { contains: searchStr, mode: 'insensitive' } },
        { playerId: { contains: searchStr, mode: 'insensitive' } },
      ]
    }

    const [orders, totalRows] = await Promise.all([
      prisma.order.findMany({
        where: whereOrders,
        orderBy: { createdAt: 'desc' },
        ...(searchStr ? {} : {
          skip: (pageNum - 1) * pageSize,
          take: pageSize,
        }),
        select: {
          id: true, qrPayload: true, rrn: true, playerId: true,
          amount: true, feeLauncx: true, settlementAmount: true,
          pendingAmount: true, status: true, settlementStatus: true, createdAt: true,
          paymentReceivedTime: true,
          settlementTime:      true,
          trxExpirationTime:   true,
        }
      }),
      prisma.order.count({ where: whereOrders })
    ]);
/// (5) totalTransaksi -> hitung langsung di DB dengan status filter user
const totalAgg = await prisma.order.aggregate({
  _sum: { amount: true },
  where: {
    partnerClientId: { in: clientIds },
    status: { in: statuses },
    ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
  }
});
const totalAmount = totalAgg._sum.amount ?? 0; // sum of amounts

// totalRows sudah dihitung sebelumnya sebagai count
const totalCount = totalRows; // jumlah order matching filter

// (6) map ke response
const transactions = orders.map(o => {
  const netSettle = o.status === 'PAID'
    ? (o.pendingAmount ?? 0)
    : (o.settlementAmount ?? 0);
  return {
    id: o.id,
    date: o.createdAt.toISOString(),
    reference: o.qrPayload ?? '',
    rrn: o.rrn ?? '',
    playerId: o.playerId,
    amount: o.amount,
    feeLauncx: o.feeLauncx ?? 0,
    netSettle,
    settlementStatus: o.settlementStatus ?? '',
    status: o.status === 'SETTLED' ? 'SUCCESS' : o.status,
    paymentReceivedTime: o.paymentReceivedTime?.toISOString() ?? '',
    settlementTime:      o.settlementTime?.toISOString()      ?? '',
    trxExpirationTime:   o.trxExpirationTime?.toISOString()   ?? '',
  };
});

return res.json({
  balance: totalActive,
  totalPending,
  totalAmount,      // baru: sum of amount
  totalCount,       // baru: jumlah transaksi (dipakai di summary)
  // backward compatibility jika frontend lama masih pakai:
  totalTransaksi: totalCount, // kalau summary mau count, biarkan ini jadi count
  total: totalCount,          // pagination logic masih bisa pakai ini
  transactions,
  children: pc.children
});
} catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export async function exportClientTransactions(req: ClientAuthRequest, res: Response) {
  try {
    // 1) load user + children
    const user = await prisma.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          include: { children: { select: { id: true, name: true } } }
        }
      }
    })
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
    const pc = user.partnerClient!

    // 2) tanggal
    const dateFrom = req.query.date_from ? new Date(String(req.query.date_from)) : undefined
    const dateTo   = req.query.date_to ? new Date(String(req.query.date_to)) : undefined
    const createdAt: any = {}
    if (dateFrom) createdAt.gte = dateFrom
    if (dateTo)   createdAt.lte = dateTo

    // 3) clientIds override
    const isParent = pc.children.length > 0
    let clientIds = isParent
      ? [pc.id, ...pc.children.map(c => c.id)]
      : [pc.id]
    if (typeof req.query.clientId === 'string' && req.query.clientId !== 'all' && req.query.clientId.trim()) {
      clientIds = [String(req.query.clientId)]
    }

    // 4) status filter expansion
    const rawStatus = req.query.status
    const allowed = DASHBOARD_STATUSES as readonly string[]
    let statuses: string[] = []
    if (Array.isArray(rawStatus)) {
      statuses = rawStatus
        .map(String)
        .flatMap(s => (s === 'SUCCESS' ? ['SUCCESS', 'DONE', 'SETTLED'] : [s]))
        .filter(s => allowed.includes(s))
    } else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
      statuses = rawStatus
        .split(',')
        .map(s => s.trim())
        .flatMap(s => (s === 'SUCCESS' ? ['SUCCESS', 'DONE', 'SETTLED'] : [s]))
        .filter(s => allowed.includes(s))
    }
    if (statuses.length === 0) statuses = [...allowed]
    const statusWhere = { in: statuses }

    // optional protection: prevent too-big synchronous export
    const totalRows = await prisma.order.count({
      where: {
        partnerClientId: { in: clientIds },
        status: statusWhere,
        ...(dateFrom || dateTo ? { createdAt } : {})
      }
    })
    const MAX_SYNC_EXPORT = 200_000
    if (totalRows > MAX_SYNC_EXPORT) {
      return res.status(400).json({
        error: `Data terlalu banyak untuk diexport langsung (${totalRows} baris). Persempit range atau gunakan export background.`
      })
    }

    // 5) id->name map
    const idToName: Record<string,string> = {}
    pc.children.forEach(c => { idToName[c.id] = c.name })
    idToName[pc.id] = pc.name

    // 6) headers
    res.setHeader('Content-Disposition', 'attachment; filename=client-transactions.xlsx')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    // 7) streaming workbook
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: false,
      useSharedStrings: true,
    })

    const all = wb.addWorksheet('All Transactions')
    all.columns = [
      { header: 'Child Name', key: 'name',     width: 30 },
      { header: 'Order ID',   key: 'id',       width: 36 },
      { header: 'RRN',        key: 'rrn',      width: 24 },
      { header: 'Player ID',  key: 'player',   width: 20 },
      { header: 'Amount',     key: 'amt',      width: 15 },
      { header: 'Pending',    key: 'pend',     width: 15 },
      { header: 'Settled',    key: 'sett',     width: 15 },
      { header: 'Fee',        key: 'fee',      width: 15 },
      { header: 'Status',     key: 'stat',     width: 16 },
      { header: 'Date',       key: 'date',     width: 20 },
      { header: 'Paid At',    key: 'paidAt',    width: 20 },
      { header: 'Settled At', key: 'settledAt', width: 20 },
      { header: 'Expires At', key: 'expiresAt', width: 20 },
    ]

    // 8) chunked fetch + write
    const CHUNK_SIZE = 1000
    let cursor: { id: string } | undefined = undefined

    while (true) {
      const batch = await prisma.order.findMany({
        where: {
          partnerClientId: { in: clientIds },
          status: statusWhere,
          ...(dateFrom || dateTo ? { createdAt } : {}),
        },
        orderBy: { createdAt: 'desc' as const },
        take: CHUNK_SIZE,
        ...(cursor ? { cursor, skip: 1 } : {}),
        select: {
          partnerClientId:  true,
          id:               true,
          rrn:              true,
          playerId:         true,
          amount:           true,
          pendingAmount:    true,
          settlementAmount: true,
          feeLauncx:        true,
          status:           true,
          createdAt:        true,
          paymentReceivedTime: true,
          settlementTime:      true,
          trxExpirationTime:   true,
        }
      })

      if (batch.length === 0) break

      for (const o of batch) {
        all.addRow({
          name:     idToName[o.partnerClientId] || o.partnerClientId,
          id:       o.id,
          rrn:      o.rrn ?? '',
          player:   o.playerId,
          amt:      o.amount,
          pend:     o.pendingAmount ?? 0,
          sett:     o.settlementAmount ?? 0,
          fee:      o.feeLauncx ?? 0,
          stat:     o.status === 'SETTLED' ? 'SUCCESS' : o.status,
          date:     formatDateJakarta(o.createdAt),
          paidAt:    o.paymentReceivedTime ? formatDateJakarta(o.paymentReceivedTime) : '',
          settledAt: o.settlementTime      ? formatDateJakarta(o.settlementTime)      : '',
          expiresAt: o.trxExpirationTime   ? formatDateJakarta(o.trxExpirationTime)   : '',
        }).commit()
      }

      cursor = { id: batch[batch.length - 1].id }
    }

    // 9) finalize
    await all.commit()
    await wb.commit()
    res.end()
  } catch (err: any) {
    console.error('[exportClientTransactions]', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export data' })
    } else {
      // if headers already sent, we can't change status; just end
      try { res.end() } catch {}
    }
  }
}

export async function retryTransactionCallback(
  req: ClientAuthRequest,
  res: Response
) {
  const orderId = req.params.id;
  if (!orderId) {
    return res.status(400).json({ error: 'Missing orderId' });
  }

  // 1) Load Order sebagai source of truth, termasuk status dan settlementStatus
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      partnerClientId: true,
      amount: true,
      feeLauncx: true,
      qrPayload: true,
      status: true,            // ← ambil status final
      settlementStatus: true   // ← ambil settlementStatus final
    }
  });
  if (!order) {
    return res.status(404).json({ error: 'Order tidak ditemukan' });
  }
  if (!isCallbackStatusAllowed(order.status)) {
    return res
      .status(400)
      .json({ error: `Status ${order.status} tidak bisa retry callback` });
  }
  // 2) Verifikasi hak akses
  const allowed = [req.partnerClientId!, ...(req.childrenIds ?? [])];
  if (!allowed.includes(order.partnerClientId!)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // 3) Load konfigurasi callback partner
  const partner = await prisma.partnerClient.findUnique({
    where: { id: order.partnerClientId },
    select: { callbackUrl: true, callbackSecret: true }
  });
  if (!partner?.callbackUrl || !partner.callbackSecret) {
    return res.status(400).json({ error: 'Callback belum diset' });
  }

  // Ambil CallbackJob terbaru untuk order ini
  const jobs = await prisma.callbackJob.findMany({
    where: { delivered: false },
    orderBy: { createdAt: 'desc' },
  })
  const job = jobs.find(j => (j.payload as any)?.orderId === orderId)
  if (!job) {
    return res.status(404).json({ error: 'Callback job tidak ditemukan' })
  }

  // 4) Gunakan payload dari CallbackJob
  const clientPayload = job.payload as any

  // 5) Sign dan kirim ulang
  const sig = job.signature
  const url = job.url

  try {
    await retry(() =>
      axios.post(url, clientPayload, {
        headers: { 'X-Callback-Signature': sig },
        timeout: 5000
      })
    );
    return res.json({ success: true });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: err.message || 'Gagal mengirim callback' });
  }
}
