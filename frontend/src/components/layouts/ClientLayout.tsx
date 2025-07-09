'use client'

import { ReactNode, useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, Home, CreditCard, Bell, Settings as IconSettings, LogOut } from 'lucide-react'
import { motion } from 'framer-motion'
import styles from './ClientLayout.module.css'

interface ClientLayoutProps {
  children: ReactNode
}

const navItems = [
  { label: 'Dashboard',         href: '/client/dashboard',         Icon: Home },
  { label: 'Withdraw',          href: '/client/withdraw',          Icon: CreditCard },
  { label: 'Settings', href: '/client/callback-settings', Icon: IconSettings },
]

export default function ClientLayout({ children }: ClientLayoutProps) {
  const [open, setOpen] = useState(false)
  const path = usePathname()
  const router = useRouter()

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const handleLogout = () => {
    // 1) Hapus token
    localStorage.removeItem('token')
    // 2) Redirect ke login
    router.replace('/client/login')
  }

  return (
    <div className={styles.container}>
      <motion.aside
        className={styles.sidebar}
        initial={{ width: open ? 72 : 240 }}
        animate={{ width: open ? 240 : 72, opacity: open ? 1 : 0.95 }}
        transition={{ ease: 'easeInOut', duration: 0.3 }}
      >
        <div className={styles.logo}>
          <span className={styles.logoIcon}>🌐</span>
          {open && <span className={styles.logoText}>PORTAL</span>}
        </div>

        <nav className={styles.nav}>
          {navItems.map(({ label, href, Icon }) => (
            <Link
              key={href}
              href={href}
              className={`${styles.navItem} ${path === href ? styles.active : ''}`}
              onClick={() => setOpen(false)}
            >
              <Icon size={20} />
              {open && <span className={styles.navText}>{label}</span>}
            </Link>
          ))}
        </nav>

        {open && (
          <button
            className={styles.logoutBtn}
            onClick={handleLogout}
            type="button"
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        )}
      </motion.aside>

      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} />}

      <div className={styles.main}>
        <header className={styles.header}>
          <button
            className={styles.toggleBtn}
            onClick={() => setOpen(o => !o)}
            aria-label="Toggle sidebar"
          >
            <Menu size={24} />
          </button>
          <h1 className={styles.title}>Client Dashboard</h1>
          <div className={styles.headerRight}>
            <Bell size={20} className={styles.iconBtn} />
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  )
}
