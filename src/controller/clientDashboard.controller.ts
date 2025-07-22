// src/controllers/clientDashboard.controller.ts

import { Response } from 'express'
import { prisma } from '../core/prisma'
import { DisbursementStatus } from '@prisma/client'
import { ClientAuthRequest } from '../middleware/clientAuth'
import ExcelJS from 'exceljs'
import crypto from 'crypto';
import axios from 'axios';

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
      statuses = rawStatus.map(String).filter(s => allowed.includes(s));
    } else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
      statuses = rawStatus.split(',').map(s => s.trim()).filter(s => allowed.includes(s));
    }
    if (statuses.length === 0) statuses = [...allowed];

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

    // (4c) ambil transaksi seperti biasa (tetap pakai DASHBOARD_STATUSES biar tabel aman)
    const orders = await prisma.order.findMany({
      where: {
        partnerClientId: { in: clientIds },
        status: { in: DASHBOARD_STATUSES },
        ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, qrPayload: true, rrn: true, playerId: true,
        amount: true, feeLauncx: true, settlementAmount: true,
        pendingAmount: true, status: true, settlementStatus: true, createdAt: true,
        paymentReceivedTime: true,
        settlementTime:      true,
        trxExpirationTime:   true,
      }
    });

// (5) totalTransaksi -> hitung langsung di DB dengan status filter user
const totalAgg = await prisma.order.aggregate({
  _sum: { amount: true },
  where: {
    partnerClientId: { in: clientIds },
    status: { in: statuses },                         // <- status yang kamu pilih
    ...(dateFrom || dateTo ? { createdAt: createdAtFilter } : {})
  }
});
const totalTransaksi = totalAgg._sum.amount ?? 0;

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
      totalTransaksi,
      transactions,
      children: pc.children
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

export async function exportClientTransactions(req: ClientAuthRequest, res: Response) {
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
  const dateTo   = req.query.date_to   ? new Date(String(req.query.date_to))   : undefined
  const createdAt: any = {}
  if (dateFrom) createdAt.gte = dateFrom
  if (dateTo)   createdAt.lte = dateTo

  // 3) clientIds
  const isParent = pc.children.length > 0
  let clientIds = isParent
    ? [pc.id, ...pc.children.map(c => c.id)]
    : [pc.id]

  // jika FE kirim clientId tertentu → override
  if (typeof req.query.clientId === 'string' && req.query.clientId !== 'all' && req.query.clientId.trim()) {
    clientIds = [String(req.query.clientId)]
  }

  // 4) status filter (samain dengan dashboard)
  const mapStatus = (s?: string) => {
    if (!s) return { in: DASHBOARD_STATUSES }
    if (s === 'SUCCESS') return { in: ['SUCCESS', 'SETTLED'] }
    return s
  }
  const statusParam = (req.query.status as string | undefined)?.trim()
  const statusWhere = mapStatus(statusParam)

  // 5) query orders
  const orders = await prisma.order.findMany({
    where: {
      partnerClientId: { in: clientIds },
      status: statusWhere,
      ...(dateFrom || dateTo ? { createdAt } : {})
    },
    orderBy: { createdAt: 'desc' },
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

  // 6) map ID → name
  const idToName: Record<string,string> = {}
  pc.children.forEach(c => { idToName[c.id] = c.name })
  idToName[pc.id] = pc.name

  // 7) workbook
  const wb = new ExcelJS.Workbook()
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

  orders.forEach(o => {
    all.addRow({
      name:     idToName[o.partnerClientId] || o.partnerClientId,
      id:       o.id,
      rrn:      o.rrn ?? '',
      player:   o.playerId,
      amt:      o.amount,
      pend:     o.pendingAmount ?? 0,
      sett:     o.settlementAmount ?? 0,
      fee:      o.feeLauncx ?? 0,
      stat:     o.status,
      date:     o.createdAt.toISOString(),
      paidAt:    o.paymentReceivedTime?.toISOString() ?? '',
      settledAt: o.settlementTime?.toISOString()      ?? '',
      expiresAt: o.trxExpirationTime?.toISOString()   ?? '',
    })
  })

  // 8) sheet per child
  for (const child of pc.children) {
    const sheet = wb.addWorksheet(child.name)
    sheet.columns = all.columns.slice(1) // tanpa 'Child Name'
    const list = orders.filter(o => o.partnerClientId === child.id)
    list.forEach(o => {
      sheet.addRow({
        id:       o.id,
        rrn:      o.rrn ?? '',
        player:   o.playerId,
        amt:      o.amount,
        pend:     o.pendingAmount ?? 0,
        sett:     o.settlementAmount ?? 0,
        fee:      o.feeLauncx ?? 0,
        stat:     o.status,
        date:     o.createdAt.toISOString(),
        paidAt:    o.paymentReceivedTime?.toISOString() ?? '',
        settledAt: o.settlementTime?.toISOString()      ?? '',
        expiresAt: o.trxExpirationTime?.toISOString()   ?? '',
      })
    })
  }

  // 9) kirim
  res.setHeader('Content-Disposition','attachment; filename=client-transactions.xlsx')
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  await wb.xlsx.write(res)
  res.end()
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

  // 4) Bangun payload dari Order
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();

  const clientPayload = {
    orderId,
    status: order.status,                     // pakai value dari Order
    settlementStatus: order.settlementStatus, // pakai value dari Order
    grossAmount: order.amount,
    feeLauncx: order.feeLauncx ?? 0,
    netAmount: order.amount - (order.feeLauncx ?? 0),
    qrPayload: order.qrPayload,
    timestamp,
    nonce
  };

  // 5) Sign dan kirim ulang
  const sig = crypto
    .createHmac('sha256', partner.callbackSecret)
    .update(JSON.stringify(clientPayload))
    .digest('hex');

  try {
    await retry(() =>
      axios.post(partner.callbackUrl!, clientPayload, {
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
