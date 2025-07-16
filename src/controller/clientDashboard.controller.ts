// src/controllers/clientDashboard.controller.ts

import { Response } from 'express'
import { prisma } from '../core/prisma'
import { DisbursementStatus } from '@prisma/client'
import { ClientAuthRequest } from '../middleware/clientAuth'
import ExcelJS from 'exceljs'
import crypto from 'crypto';
import { retry } from '../utils/retry';




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
    console.log('--- getClientDashboard START ---');
    console.log('clientUserId:', req.clientUserId);
    console.log('query params:', req.query);

    // (1) ambil user + partnerClient + children (termasuk balance)
    const user = await prisma.clientUser.findUnique({
      where: { id: req.clientUserId! },
      include: {
        partnerClient: {
          select: {
            id: true,
            name: true,
            balance: true,         // ambil balance parent
            children: {
              select: {
                id: true,
                name: true,
                balance: true      // ambil balance tiap child
              }
            }
          }
        }
      }
    });
    if (!user) {
      console.warn('User tidak ditemukan untuk id', req.clientUserId);
      return res.status(404).json({ error: 'User tidak ditemukan' });
    }
    const pc = user.partnerClient!;
    console.log('partnerClient loaded:', { id: pc.id, childrenCount: pc.children.length });

    // (2) parse tanggal
    const dateFrom = req.query.date_from ? new Date(String(req.query.date_from)) : undefined;
    const dateTo   = req.query.date_to   ? new Date(String(req.query.date_to))   : undefined;
    const createdAtFilter: any = {};
    if (dateFrom) createdAtFilter.gte = dateFrom;
    if (dateTo)   createdAtFilter.lte = dateTo;

    // (3) build list of IDs to query
    let clientIds: string[];
    if (typeof req.query.clientId === 'string'
        && req.query.clientId !== 'all'
        && req.query.clientId.trim()
    ) {
      clientIds = [req.query.clientId];  // child-only
      console.log('override dengan single child:', clientIds);
    } else if (pc.children.length > 0) {
      clientIds = [pc.id, ...pc.children.map(c => c.id)];  // parent + all children
      console.log('parent + children => clientIds:', clientIds);
    } else {
      clientIds = [pc.id];  // no children
      console.log('user biasa => clientIds:', clientIds);
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
    console.log('totalPending:', totalPending);

    // (4b) HITUNG TOTAL ACTIVE BALANCE BERDASARKAN clientIds
    const parentBal = clientIds.includes(pc.id)
      ? pc.balance ?? 0
      : 0;
    const childrenBal = pc.children
      .filter(c => clientIds.includes(c.id))
      .reduce((sum, c) => sum + (c.balance ?? 0), 0);
    const totalActive = parentBal + childrenBal;
    console.log('totalActive (filtered):', totalActive);

    // (4c) ambil transaksi seperti biasa
    const orders = await prisma.order.findMany({
      where: {
        partnerClientId: { in: clientIds },
        status: { in: ['SUCCESS','DONE','SETTLED','PAID','PENDING','EXPIRED'] },
        ...(dateFrom||dateTo ? { createdAt: createdAtFilter } : {})
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
    console.log(`ditemukan ${orders.length} order(s)`);

    // (5) hitung totalTransaksi
    const totalTransaksi = orders
      .filter(o => o.status !== 'PAID')
      .reduce((sum, o) => sum + o.amount, 0);
    console.log('totalTransaksi:', totalTransaksi);

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
        status: o.status === 'DONE' ? 'DONE' : 'SUCCESS',
       // tambahkan ISO-string dari tiga timestamp:
        paymentReceivedTime: o.paymentReceivedTime?.toISOString() ?? '',
        settlementTime:      o.settlementTime?.toISOString()      ?? '',
        trxExpirationTime:   o.trxExpirationTime?.toISOString()   ?? '',      };
    });

    console.log('--- getClientDashboard END ---');
    return res.json({
      balance: totalActive,      // pakai totalActive yang sudah ter-filter
      totalPending,
      totalTransaksi,
      transactions,
      children: pc.children      // tetap kirim semua children untuk dropdown
    });

  } catch (err: any) {
    console.error('Error di getClientDashboard:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}


export async function exportClientTransactions(req: ClientAuthRequest, res: Response) {
  // (1) load user + children
  const user = await prisma.clientUser.findUnique({
    where: { id: req.clientUserId! },
    include: {
      partnerClient: {
        include: {
          children: { select: { id: true, name: true } }
        }
      }
    }
  })
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' })
  const pc = user.partnerClient

  // (2) parse tanggal
  const dateFrom = req.query.date_from ? new Date(String(req.query.date_from)) : undefined
  const dateTo   = req.query.date_to   ? new Date(String(req.query.date_to))   : undefined
  const createdAtFilter: any = {}
  if (dateFrom) createdAtFilter.gte = dateFrom
  if (dateTo)   createdAtFilter.lte = dateTo

  // (3) siapkan daftar IDs
const clientIds = req.isParent
  ? [pc.id, ...pc.children.map(c => c.id)]  // <<< include parent juga
  : [pc.id]
console.log('export clientIds:', clientIds)

  // (4) ambil semua order
  const orders = await prisma.order.findMany({
    where: {
      partnerClientId: { in: clientIds },
      status: { in: ['SUCCESS','DONE','SETTLED','PAID'] },
      ...(dateFrom||dateTo ? { createdAt: createdAtFilter } : {})
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

  // (5) map ID→name untuk semua child
  const idToName: Record<string,string> = {}
  pc.children.forEach(c => { idToName[c.id] = c.name })
  // (opsional, jika parent juga mau ditampilkan di All-sheet)
  idToName[pc.id] = pc.name

  // (6) group per partnerClientId
  const byClient: Record<string, typeof orders> = {}
  orders.forEach(o => {
    byClient[o.partnerClientId] ??= []
    byClient[o.partnerClientId].push(o)
  })

  // (7) buat workbook + sheet “All Transactions”
  const wb = new ExcelJS.Workbook()
  const all = wb.addWorksheet('All Transactions')
  all.columns = [
    { header: 'Child Name', key: 'name',   width: 30 },
    { header: 'Order ID',    key: 'id',     width: 36 },
    { header: 'RRN',         key: 'rrn',    width: 24 },
    { header: 'Player ID',   key: 'player', width: 20 },
    { header: 'Amount',      key: 'amt',    width: 15 },
    { header: 'Pending',     key: 'pend',   width: 15 },
    { header: 'Settled',     key: 'sett',   width: 15 },
    { header: 'Fee',         key: 'fee',    width: 15 },
    { header: 'Status',      key: 'stat',   width: 16 },
    { header: 'Date',        key: 'date',   width: 20 },
    { header: 'Paid At',     key: 'paidAt',    width: 20 },
  { header: 'Settled At',  key: 'settledAt', width: 20 },
  { header: 'Expires At',  key: 'expiresAt', width: 20 },
  ]

  orders.forEach(o => {
    all.addRow({
      name:   idToName[o.partnerClientId] || o.partnerClientId,
      id:     o.id,
      rrn:    o.rrn ?? '',
      player: o.playerId,
      amt:    o.amount,
      pend:   o.pendingAmount ?? 0,
      sett:   o.settlementAmount ?? 0,
      fee:    o.feeLauncx ?? 0,
      stat:   o.status,
    date:   o.createdAt.toISOString(),
    // isi kolom timestamp
    paidAt:    o.paymentReceivedTime?.toISOString() ?? '',
    settledAt: o.settlementTime?.toISOString()      ?? '',
    expiresAt: o.trxExpirationTime?.toISOString()   ?? '',    })
  })

  // (8) buat sheet per child
  for (const child of pc.children) {
    const sheet = wb.addWorksheet(child.name)
    sheet.columns = all.columns.slice(1).concat([
      { header: 'Paid At',     key: 'paidAt',    width: 20 },
      { header: 'Settled At',  key: 'settledAt', width: 20 },
      { header: 'Expires At',  key: 'expiresAt', width: 20 },
    ])    
    const list = byClient[child.id] || []
    list.forEach(o => {
      sheet.addRow({
        id:     o.id,
        rrn:    o.rrn ?? '',
        player: o.playerId,
        amt:    o.amount,
        pend:   o.pendingAmount ?? 0,
        sett:   o.settlementAmount ?? 0,
        fee:    o.feeLauncx ?? 0,
        stat:   o.status,
        date:   o.createdAt.toISOString(),
        paidAt:    o.paymentReceivedTime?.toISOString() ?? '',
        settledAt: o.settlementTime?.toISOString()      ?? '',
        expiresAt: o.trxExpirationTime?.toISOString()   ?? '',
      })
    })
  }

  // (9) kirim file
  res.setHeader('Content-Disposition','attachment; filename=client-transactions.xlsx')
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  await wb.xlsx.write(res)
  res.end()
}

