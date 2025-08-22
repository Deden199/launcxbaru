import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import axios from 'axios'
import styles from './AdminAuth.module.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const MERCHANT_URL = process.env.NEXT_PUBLIC_MERCHANT_URL || '/'

export default function PaymentSuccess() {
  const router = useRouter()
  const { id } = router.query
  const [details, setDetails] = useState<any>(null)

  useEffect(() => {
    if (id) {
      axios
        .get(`${API_URL}/payments/${id}`)
        .then(res => setDetails(res.data))
        .catch(() => {})
    }
  }, [id])

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Payment Successful</h1>
        {details && (
          <pre style={{ textAlign: 'left', fontSize: '0.8rem' }}>
            {JSON.stringify(details, null, 2)}
          </pre>
        )}
        <a href={MERCHANT_URL} className={styles.button}>
          Back to Merchant
        </a>
      </div>
    </div>
  )
}

PaymentSuccess.disableLayout = true
