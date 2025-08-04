import { Withdrawal } from '@/types/dashboard'
import styles from '@/pages/Dashboard.module.css'

interface WithdrawalHistoryProps {
  loadingWd: boolean
  withdrawals: Withdrawal[]
}

export default function WithdrawalHistory({ loadingWd, withdrawals }: WithdrawalHistoryProps) {
  return (
    <section className={styles.tableSection} style={{ marginTop: 32 }}>
      <h2>Withdrawal History</h2>
      {loadingWd ? (
        <div className={styles.loader}>Loading withdrawals…</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Ref ID</th>
                <th>Account Name</th>
                <th>Alias</th>
                <th>Account No.</th>
                <th>Bank Code</th>
                <th>Bank Name</th>
                <th>Branch</th>
                <th>Wallet/Submerchant</th>
                <th>Withdrawal Fee</th>
                <th>Amount</th>
                <th>Net Amount</th>
                <th>PG Fee</th>
                <th>PG Trx ID</th>
                <th>In Process</th>
                <th>Status</th>
                <th>Completed At</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.length ? (
                withdrawals.map(w => (
                  <tr key={w.id}>
                    <td>
                      {new Date(w.createdAt).toLocaleString('id-ID', {
                        dateStyle: 'short',
                        timeStyle: 'short'
                      })}
                    </td>
                    <td>{w.refId}</td>
                    <td>{w.accountName}</td>
                    <td>{w.accountNameAlias}</td>
                    <td>{w.accountNumber}</td>
                    <td>{w.bankCode}</td>
                    <td>{w.bankName}</td>
                    <td>{w.branchName ?? '-'}</td>
                    <td>{w.wallet}</td>
                    <td>
                      {(w.amount - (w.netAmount ?? 0)).toLocaleString('id-ID', {
                        style: 'currency',
                        currency: 'IDR'
                      })}
                    </td>
                    <td>
                      {w.amount.toLocaleString('id-ID', {
                        style: 'currency',
                        currency: 'IDR'
                      })}
                    </td>
                    <td>
                      {w.netAmount != null
                        ? w.netAmount.toLocaleString('id-ID', {
                            style: 'currency',
                            currency: 'IDR'
                          })
                        : '-'}
                    </td>
                    <td>
                      {w.pgFee != null
                        ? w.pgFee.toLocaleString('id-ID', {
                            style: 'currency',
                            currency: 'IDR'
                          })
                        : '-'}
                    </td>
                    <td>{w.paymentGatewayId ?? '-'}</td>
                    <td>{w.isTransferProcess ? 'Yes' : 'No'}</td>
                    <td>{w.status}</td>
                    <td>
                      {w.completedAt
                        ? new Date(w.completedAt).toLocaleString('id-ID', {
                            dateStyle: 'short',
                            timeStyle: 'short'
                          })
                        : '-'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={17} className={styles.noData}>
                    No withdrawals
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
