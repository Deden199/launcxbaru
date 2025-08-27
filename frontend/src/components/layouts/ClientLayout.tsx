'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, Home, CreditCard, Bell, Settings as IconSettings, LogOut, FileText } from 'lucide-react'
import { motion } from 'framer-motion'

interface ClientLayoutProps {
  children: ReactNode
}

const navItems = [
  { label: 'Dashboard', href: '/client/dashboard', Icon: Home },
  { label: 'Withdraw', href: '/client/withdraw', Icon: CreditCard },
  { label: 'API Logs', href: '/client/api-log', Icon: FileText },
  { label: 'Settings', href: '/client/callback-settings', Icon: IconSettings },
]

// helper: active untuk parent & sub-route
function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/')
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname() || ''
  const router = useRouter()

  // Lock scroll saat sidebar (mobile) terbuka
  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024
    document.body.style.overflow = open && isMobile ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const asideWidth = open ? 240 : 72

  const handleLogout = () => {
    localStorage.removeItem('clientToken') // konsisten dgn login
    router.replace('/client/login')
  }

  return (
    // Paksa dark mode
    <div className="dark min-h-screen w-full bg-neutral-950 text-neutral-100">
      {/* Sidebar */}
      <motion.aside
        initial={{ width: asideWidth, opacity: 0 }}
        animate={{ width: asideWidth, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className="fixed left-0 top-0 z-40 h-full border-r border-neutral-800 bg-neutral-900/70 backdrop-blur supports-[backdrop-filter]:bg-neutral-900/60"
      >
        {/* Logo + toggle */}
        <div className="flex h-16 items-center justify-between px-3">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 rounded-xl border border-neutral-800 px-3 py-2 text-sm font-semibold hover:bg-neutral-800/60"
            aria-label="Toggle sidebar"
          >
            <span className="text-lg">🌐</span>
            {open && <span className="tracking-wide">PORTAL</span>}
          </button>
        </div>

        {/* Nav */}
        <nav className="mt-2 flex flex-col gap-1 px-2">
          {navItems.map(({ label, href, Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => {
                  if (window.innerWidth < 1024) setOpen(false)
                }}
                aria-current={active ? 'page' : undefined}
                className={[
                  'group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition',
                  active
                    ? 'border-indigo-900/50 bg-indigo-950/40 text-indigo-300'
                    : 'border-transparent hover:border-neutral-800 hover:bg-neutral-900/60',
                ].join(' ')}
              >
                <Icon className={active ? 'text-indigo-300' : 'text-neutral-400'} size={20} />
                {open && <span className="truncate">{label}</span>}

                {/* Tooltip saat collapsed */}
                {!open && (
                  <span className="pointer-events-none absolute left-[60px] z-50 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 opacity-0 shadow-sm ring-1 ring-black/5 transition group-hover:opacity-100">
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
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-800 px-3 py-2 text-sm font-medium hover:bg-neutral-800/60"
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
          </div>
        )}
      </motion.aside>

      {/* Backdrop untuk mobile */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Main (geser sesuai lebar aside) */}
      <div
        className="min-h-screen transition-[margin] duration-200"
        style={{ marginLeft: `${asideWidth}px` }}
      >
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-neutral-800 bg-neutral-900/60 px-4 backdrop-blur supports-[backdrop-filter]:bg-neutral-900/40">
          <button
            onClick={() => setOpen(o => !o)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60"
            aria-label="Toggle sidebar"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-base font-semibold tracking-tight">Client Dashboard</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 hover:bg-neutral-800/60"
              aria-label="Notifications"
            >
              <Bell size={18} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="p-4 sm:p-6">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
