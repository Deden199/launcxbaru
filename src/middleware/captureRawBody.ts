// src/middleware/captureRawBody.ts
import { Request, Response, NextFunction } from 'express'
import getRawBody from 'raw-body'

export async function captureRawBody(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    if ((req as any).rawBody) return next()            // skip kalau sudah ada
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next()

    const buf = await getRawBody(req, { limit: '1mb' }) // batas 1 MB
    ;(req as any).rawBody = buf.toString('utf8')
    req.unshift(buf)                                     // pasang balik supaya parser lain bisa jalan
    next()
  } catch (err) {
    next(err)
  }
}
