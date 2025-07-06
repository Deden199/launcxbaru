// frontend/src/hooks/useAuth.ts
import { useEffect } from 'react'
import { useRouter } from 'next/router'

/**
 * Hook to guard routes that require authentication.
 * Redirects to /login if no token is found in localStorage.
 */
export function useRequireAuth() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
    }
  }, [router])
}
