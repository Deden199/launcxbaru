// src/controllers/qr.controller.ts
import { Request, Response } from 'express'
import axios from 'axios'
import { prisma } from '../core/prisma'

export const proxyOyQris = async (req: Request, res: Response) => {
  const orderId = req.params.orderId

  // 1) ambil data transaksi_response terakhir
  const trxResp = await prisma.transaction_response.findFirst({
    where: { referenceId: orderId },
    orderBy: { createdAt: 'desc' },
  })
  if (!trxResp) {
    return res.status(404).send('Not found')
  }

  // 2) parse responseBody (you stored JSON.stringify(qrResp))
  let qrResp: any
  try {
    qrResp = typeof trxResp.responseBody === 'string'
      ? JSON.parse(trxResp.responseBody)
      : trxResp.responseBody
  } catch {
    return res.status(500).send('Invalid stored QR response')
  }

  const qrUrl: string | undefined = qrResp.payment_info?.qris_url
  if (!qrUrl) {
    return res.status(500).send('No QR URL in response')
  }

  // 3) fetch image dari OY
  try {
    const upstream = await axios.get<ArrayBuffer>(qrUrl, {
      responseType: 'arraybuffer'
    })
    res
      .set('Content-Type', upstream.headers['content-type'] || 'image/png')
      .send(Buffer.from(upstream.data))
  } catch (err: any) {
    console.error('Error proxying QR:', err)
    res.status(502).send('Failed to fetch QR image')
  }
}
