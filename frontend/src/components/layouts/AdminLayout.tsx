'use client'

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Menu,
  Home,
  Box,
  LogOut,
  Settings,
  BadgeCheck as BoomBox, // lucide-react: pengganti ikon BoomBox
  ShieldCheck,
  FileText,
  User,
  Banknote,
  Wrench,
  Wallet,
} from 'lucide-react'
import { motion } from 'framer-motion'

interface AdminLayoutProps {
  children: ReactNode
}

const navItems = [
  { label: 'Dashboard',         href: '/dashboard',        Icon: Home },
  { label: 'API Clients',       href: '/admin/clients',    Icon: Box },
  { label: 'Client Balances',   href: '/admin/client-balances',    Icon: Wallet },
  { label: 'Merchant Settings', href: '/admin/merchants',  Icon: BoomBox },
  { label: 'Admins',            href: '/admin/users',      Icon: User },
  { label: '2FA Setup',         href: '/admin/2fa',        Icon: ShieldCheck },
  { label: 'Settings',       href: '/admin/settings',   Icon: Settings },
  { label: 'Settlement',        href: '/admin/settlement', Icon: Banknote },
  { label: 'Settlement Adjust', href: '/admin/settlement-adjust', Icon: Wrench },
  { label: 'Logs',              href: '/admin/logs',       Icon: FileText },
]

// aktif juga untuk child paths
function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === href
  return pathname === href || pathname.startsWith(href + '/')
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const pathname = usePathname() || ''
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const isMounted = useRef(false)

  // default open untuk layar lg+, closed untuk mobile
  useEffect(() => {
    const onResize = () => {
      setOpen(window.innerWidth >= 1024)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Lock scroll ketika sidebar (mobile) terbuka
  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024
    document.body.style.overflow = open && isMobile ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const handleLogout = () => {
    localStorage.removeItem('token')
    router.push('/login')
  }

  const asideWidth = useMemo(() => (open ? 240 : 72), [open])

  // hindari flash animasi initial
  useEffect(() => {
    isMounted.current = true
  }, [])

  return (
    <div
      className="min-h-screen w-full bg-neutral-950 text-neutral-100"
      style={{ ['--aside-w' as any]: `${asideWidth}px` }}
    >
      {/* Skip to content (aksesibilitas) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only fixed left-3 top-3 z-[100] rounded-md bg-indigo-700 px-3 py-2 text-sm font-semibold text-white shadow"
      >
        Skip to content
      </a>

      {/* Sidebar */}
      <motion.aside
        initial={isMounted.current ? false : { width: asideWidth, opacity: 0 }}
        animate={{ width: asideWidth, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="fixed left-0 top-0 z-40 h-full border-r border-neutral-800 bg-neutral-900/70 backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60"
        aria-label="Sidebar"
      >
        {/* Brand / Toggle */}
        <div className="flex h-16 items-center justify-between px-3">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 rounded-xl border border-neutral-800 px-3 py-2 text-sm font-semibold hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-800"
            aria-label="Toggle sidebar"
            aria-expanded={open}
          >
            <span className="text-lg">🛠️</span>
            {open && <span className="tracking-wide">ADMIN</span>}
          </button>
        </div>

        {/* Nav */}
        <nav className="mt-2 flex flex-col gap-1 px-2" role="navigation">
          {navItems.map(({ label, href, Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => {
                  if (window.innerWidth < 1024) setOpen(false)
                }}
                className={[
                  'group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-800',
                  active
                    ? 'border-indigo-900/50 bg-indigo-950/40 text-indigo-300'
                    : 'border-transparent hover:border-neutral-800 hover:bg-neutral-900/60',
                ].join(' ')}
                aria-current={active ? 'page' : undefined}
              >
                <Icon
                  className={active ? 'text-indigo-300' : 'text-neutral-400'}
                  size={20}
                  aria-hidden="true"
                />
                {open && <span className="truncate">{label}</span>}

                {/* Tooltip ketika collapsed */}
                {!open && (
                  <span className="pointer-events-none absolute left-[60px] z-50 -translate-y-0 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 opacity-0 shadow-sm transition group-hover:opacity-100">
                    {label}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Logout (hanya saat open) */}
        {open && (
          <div className="absolute inset-x-0 bottom-0 p-3">
            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-800 px-3 py-2 text-sm font-medium hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-800"
            >
              <LogOut size={18} aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        )}
      </motion.aside>

      {/* Backdrop untuk mobile */}
      {open && (
        <button
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          aria-label="Close sidebar"
        />
      )}

      {/* Main content (offset pakai CSS var agar bebas layout shift) */}
      <div
        className="min-h-screen transition-[margin] duration-200"
        style={{ marginInlineStart: 'var(--aside-w)' }}
      >
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-neutral-800 bg-neutral-900/60 px-4 backdrop-blur supports-[backdrop-filter]:bg-neutral-900/40">
          <button
            onClick={() => setOpen(o => !o)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-indigo-800"
            aria-label="Toggle sidebar"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <h1 className="text-base font-semibold tracking-tight">Admin Dashboard</h1>

          <div className="ml-auto flex items-center gap-2">
            {/* optional actions */}
            {/* <button className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800">
              <Settings size={18} />
            </button> */}
          </div>
        </header>

        {/* Content */}
        <main id="main-content" className="p-4 sm:p-6">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
