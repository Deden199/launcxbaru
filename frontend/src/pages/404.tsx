// pages/404.tsx
import { NextPage } from 'next'
import Link from 'next/link'
import { motion } from 'framer-motion'

const Custom404: NextPage & { disableLayout?: boolean } = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#f5f7fa',
      color: '#333',
      padding: '0 1rem',
      textAlign: 'center',
    }}>
      <motion.h1
        style={{ fontSize: '6rem', margin: 0 }}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 120 }}
      >
        404
      </motion.h1>

      <motion.p
        style={{ fontSize: '1.5rem', margin: '1rem 0 2rem' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        Oops! Halaman yang kamu cari nggak ketemu.
      </motion.p>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Link
          href="/"
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            background: '#0070f3',
            color: '#fff',
            borderRadius: '5px',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Kembali ke Beranda
        </Link>
      </motion.div>
    </div>
  )
}

// supaya _app.tsx skip semua layout
Custom404.disableLayout = true

export default Custom404
