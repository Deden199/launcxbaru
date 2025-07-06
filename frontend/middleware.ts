// File: frontend/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const token = req.cookies.get('token')?.value
  const { pathname } = req.nextUrl

  // Kalau akses admin dashboard (contoh: /dashboard atau /dashboard/...)
  if (pathname.startsWith('/dashboard') && !token) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Kalau akses client dashboard (misal kamu host di /client/dashboard)
  if (pathname.startsWith('/client/dashboard') && !token) {
    const url = req.nextUrl.clone()
    url.pathname = '/client/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/client/dashboard/:path*'
  ],
}
