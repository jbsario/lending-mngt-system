import { useEffect, useState } from 'react'
import { getDashboardStats, listRecentPayments } from '../lib/api'
import { Users, Landmark, AlertTriangle, Wallet } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentPayments, setRecentPayments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    setLoading(true)
    const [statsData, payments] = await Promise.all([
      getDashboardStats(),
      listRecentPayments(6)
    ])
    setStats(statsData)
    setRecentPayments(payments || [])
    setLoading(false)
  }

  if (loading) return <p className="text-slatey text-sm">Loading dashboard…</p>

  const cards = [
    { label: 'Total Borrowers', value: stats.borrowerCount, icon: Users },
    { label: 'Active Loans', value: stats.activeLoanCount, icon: Landmark },
    { label: 'Outstanding Balance', value: `₱${stats.totalOutstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: Wallet },
    { label: 'Overdue Installments', value: stats.overdueCount, icon: AlertTriangle, alert: stats.overdueCount > 0 }
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-2xl text-ink">Dashboard</h1>
        <p className="text-sm text-slatey mt-1">Portfolio overview at a glance.</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, alert }) => (
          <div key={label} className="ledger-card p-4">
            <div className="flex items-center justify-between mb-3">
              <Icon className={`w-5 h-5 ${alert ? 'text-rust' : 'text-brass'}`} strokeWidth={1.5} />
            </div>
            <p className={`text-2xl font-display ${alert ? 'text-rust' : 'text-ink'}`}>{value}</p>
            <p className="text-xs text-slatey mt-1 uppercase tracking-wide">{label}</p>
          </div>
        ))}
      </div>

      <div className="ledger-card p-5">
        <h2 className="font-display text-lg text-ink mb-4">Recent Payments</h2>
        {recentPayments.length === 0 ? (
          <p className="text-sm text-slatey">No payments recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Borrower</th>
                <th className="pb-2 font-medium">Loan #</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentPayments.map(p => (
                <tr key={p.id} className="border-b border-ledgerline last:border-0">
                  <td className="py-2 text-slatey">{p.payment_date}</td>
                  <td className="py-2">{p.loans?.borrowers?.full_name || '—'}</td>
                  <td className="py-2 stamp text-xs text-slatey">{p.loans?.loan_number}</td>
                  <td className="py-2 text-right">₱{Number(p.amount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
