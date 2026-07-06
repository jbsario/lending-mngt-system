import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listDueSchedule } from '../lib/api'
import { AlertTriangle, Clock, CalendarClock } from 'lucide-react'

function daysBetween(from, to) {
  const a = new Date(from)
  a.setHours(0, 0, 0, 0)
  const b = new Date(to)
  b.setHours(0, 0, 0, 0)
  return Math.round((b - a) / 86400000)
}

export default function Schedule() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listDueSchedule().then(setRows).finally(() => setLoading(false))
  }, [])

  const today = new Date()
  const withMeta = rows.map(r => ({
    ...r,
    daysLate: daysBetween(r.due_date, today),
    owed: Number(r.total_due) - Number(r.amount_paid)
  }))

  const overdue = withMeta.filter(r => r.daysLate > 0).sort((a, b) => b.daysLate - a.daysLate)
  const dueToday = withMeta.filter(r => r.daysLate === 0)
  const upcoming = withMeta.filter(r => r.daysLate < 0 && r.daysLate >= -7).sort((a, b) => a.daysLate - b.daysLate)
  const laterCount = withMeta.filter(r => r.daysLate < -7).length

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl text-ink">Schedule</h1>
        <p className="text-sm text-slatey mt-1">Who owes a payment right now, and who's coming up — so you know who to follow up with.</p>
      </div>

      {loading ? (
        <p className="text-sm text-slatey">Loading…</p>
      ) : (
        <div className="space-y-8">
          <ScheduleSection
            title="Overdue"
            icon={AlertTriangle}
            tone="rust"
            rows={overdue}
            empty="No overdue installments. Nice."
            renderBadge={r => `${r.daysLate} day${r.daysLate === 1 ? '' : 's'} late`}
          />
          <ScheduleSection
            title="Due Today"
            icon={Clock}
            tone="brass"
            rows={dueToday}
            empty="Nothing due today."
            renderBadge={() => 'Due today'}
          />
          <ScheduleSection
            title="Due in the Next 7 Days"
            icon={CalendarClock}
            tone="vault"
            rows={upcoming}
            empty="Nothing due in the next 7 days."
            renderBadge={r => `In ${-r.daysLate} day${-r.daysLate === 1 ? '' : 's'}`}
          />
          {laterCount > 0 && (
            <p className="text-xs text-slatey">
              {laterCount} more installment{laterCount === 1 ? '' : 's'} due further out — see each loan's repayment schedule for the full picture.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const toneClasses = {
  rust: { icon: 'text-rust', badge: 'text-rust bg-rust/10' },
  brass: { icon: 'text-brassdark', badge: 'text-brassdark bg-brass/10' },
  vault: { icon: 'text-vault', badge: 'text-vault bg-vault/10' }
}

function ScheduleSection({ title, icon: Icon, tone, rows, empty, renderBadge }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-4 h-4 ${toneClasses[tone].icon}`} strokeWidth={1.75} />
        <h2 className="font-display text-lg text-ink">{title}</h2>
        <span className="text-xs text-slatey">({rows.length})</span>
      </div>
      <div className="ledger-card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-slatey p-4">{empty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
                <th className="py-2 px-4 font-medium">Borrower / Group</th>
                <th className="py-2 px-4 font-medium">Contact</th>
                <th className="py-2 px-4 font-medium">Loan #</th>
                <th className="py-2 px-4 font-medium">Due Date</th>
                <th className="py-2 px-4 font-medium text-right">Amount Owed</th>
                <th className="py-2 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-ledgerline last:border-0">
                  <td className="py-2 px-4">{r.loans?.borrowers?.full_name || r.loans?.borrower_groups?.group_name || '—'}</td>
                  <td className="py-2 px-4 text-slatey">
                    {r.loans?.borrowers?.contact_number ? (
                      <a href={`tel:${r.loans.borrowers.contact_number}`} className="hover:text-vault hover:underline">
                        {r.loans.borrowers.contact_number}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-4">
                    <Link to={`/loans/${r.loan_id}`} className="stamp text-vault hover:underline">{r.loans?.loan_number}</Link>
                  </td>
                  <td className="py-2 px-4 text-slatey">{r.due_date}</td>
                  <td className="py-2 px-4 text-right">₱{r.owed.toLocaleString()}</td>
                  <td className="py-2 px-4">
                    <span className={`text-xs px-2 py-1 rounded ${toneClasses[tone].badge}`}>{renderBadge(r)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
