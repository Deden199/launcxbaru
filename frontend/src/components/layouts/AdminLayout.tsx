'use client'

import { ReactNode, useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, Home, Box, LogOut, Settings, BoomBox, ShieldCheck, FileText, User } from 'lucide-react'
import { motion } from 'framer-motion'
import styles from './Layout.module.css'

interface AdminLayoutProps {
  children: ReactNode
}

const navItems = [
  { label: 'Dashboard',        href: '/dashboard',       Icon: Home },
  { label: 'API Clients',      href: '/admin/clients',   Icon: Box },
  { label: 'Merchant Settings', href: '/admin/merchants', Icon: BoomBox },
  { label: 'Admins',           href: '/admin/users',     Icon: User },
  { label: '2FA Setup',        href: '/admin/2fa',       Icon: ShieldCheck },
  { label: 'WD Settings',      href: '/admin/settings',  Icon: Settings },
  { label: 'Logs',             href: '/admin/logs',      Icon: FileText },

]

export default function AdminLayout({ children }: AdminLayoutProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router   = useRouter()

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleLogout = () => {
    // 1. Hapus token atau session
    localStorage.removeItem('token')
    // (jika pakai cookie: document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT')

    // 2. Redirect ke login
    router.push('/login')
  }

  return (
    <div className={styles.container}>
      {/* Sidebar */}
      <motion.aside
        className={styles.sidebar}
        initial={{ width: open ? 240 : 72 }}
        animate={{ width: open ? 240 : 72, opacity: open ? 1 : 0.95 }}
        transition={{ duration: 0.3 }}
      >
        <div className={styles.logo} onClick={() => setOpen(o => !o)}>
          <span className={styles.logoIcon}>🛠️</span>
          {open && <span className={styles.logoText}>ADMIN</span>}
        </div>

        <nav className={styles.nav}>
          {navItems.map(({ label, href, Icon }) => (
            <Link
              key={href}
              href={href}
              className={`${styles.navItem} ${pathname === href ? styles.active : ''}`}
              onClick={() => setOpen(false)}
            >
              <Icon size={20} />
              {open && <span className={styles.navText}>{label}</span>}
            </Link>
          ))}
        </nav>

        {open && (
          <button className={styles.logoutBtn} onClick={handleLogout}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        )}
      </motion.aside>

      {/* Backdrop for mobile */}
      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} />}

      {/* Main content */}
      <div className={styles.main}>
        <header className={styles.header}>
          <button
            className={styles.toggleBtn}
            onClick={() => setOpen(o => !o)}
            aria-label="Toggle sidebar"
          >
            <Menu size={24} />
          </button>
          <h1 className={styles.title}>Admin Dashboard</h1>
          {/* <div className={styles.headerRight}>
            <Settings size={20} className={styles.iconBtn} />
          </div> */}
        </header>

        <main className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  )
}
