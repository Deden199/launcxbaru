// src/pages/_app.tsx
import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { useRouter } from 'next/router'
import AdminLayout from '@/components/layouts/AdminLayout'
import ClientLayout from '@/components/layouts/ClientLayout'

// Extend AppProps supaya Next bisa kenali flag disableLayout
type MyAppProps = AppProps & {
  Component: AppProps['Component'] & { disableLayout?: boolean }
}

export default function MyApp({ Component, pageProps }: MyAppProps) {
  const { pathname } = useRouter()

  // Kalau Component punya flag disableLayout, langsung render tanpa layout apapun
  if (Component.disableLayout) {
    return <Component {...pageProps} />
  }

  // Halaman-halaman yang tidak perlu layout khusus
  const noAdminLayout  = ['/login']
  const noClientLayout = ['/client/login']

  // 1) Halaman login admin
  if (noAdminLayout.includes(pathname)) {
    return <Component {...pageProps} />
  }

  // 2) Semua route `/client/*`
  if (pathname.startsWith('/client')) {
    // 2a) Halaman login client
    if (noClientLayout.includes(pathname)) {
      return <Component {...pageProps} />
    }
    // 2b) Halaman client lainnya
    return (
      <ClientLayout>
        <Component {...pageProps} />
      </ClientLayout>
    )
  }

  // 3) Semua selain /client dan bukan /login → pakai AdminLayout
  return (
    <AdminLayout>
      <Component {...pageProps} />
    </AdminLayout>
  )
}
