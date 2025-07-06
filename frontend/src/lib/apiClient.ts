// File: frontend/src/lib/apiClient.ts
import axios from 'axios'

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '', // e.g. http://localhost:5001/api/v1
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 seconds timeout
})

// Attach Authorization header if token exists
apiClient.interceptors.request.use(
  config => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('clientToken')
      if (token) {
        config.headers = config.headers || {}
        config.headers['Authorization'] = `Bearer ${token}`
      }
    }
    return config
  },
  error => Promise.reject(error)
)

// Global response handling
apiClient.interceptors.response.use(
  response => response,
  error => {
    const status = error.response?.status
    if (status === 401) {
      // Unauthorized: redirect to login or clear token
      localStorage.removeItem('clientToken')
      if (typeof window !== 'undefined') {
        window.location.href = '/client/login'
      }
    }
    return Promise.reject(error)
  }
)

export default apiClient
