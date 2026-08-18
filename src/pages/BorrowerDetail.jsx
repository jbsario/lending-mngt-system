import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getBorrower, listLoansForBorrower, listPaymentTotalsForLoans,
  listSmsLogsForBorrower, listPaymentsForLoan
} from '../lib/api'
import { computeLoanTotals } from '../lib/loanCalculations'
import SmsModal, { SMS_TYPES } from '../components/SmsModal'
import { ArrowLeft, MessageSquare, History, X } from 'lucide-react'

// Loans in these statuses still owe money and are what "Active Loans" /
// "Total Outstanding Balance" / the "All Active Loans" SMS scope mean
// throughout this page — same definition Payments.jsx already uses for its
// loan picker (pending/completed/written_off loans are excluded).
const OUTSTANDING_STATUSES = ['active', 'defaulted']

const statusColors = {
  pending: 'bg-ledger text-slatey',
  active: 'bg-moss/10 text-moss',
  completed: 'bg-vault/10 text-vault',
  defaulted: 'bg-rust/10 text-rust',
  written_off: 'bg-rust/10 text-rust'
}

const smsStatusColors = {
  pending: 'bg-ledger text-slatey',
  sent: 'bg-moss/10 text-moss',
  delivered: 'bg-vault/10 text-vault',
  failed: 'bg-rust/10 text-rust'
}

export default function BorrowerDetail() {
  const { id } = useParams()
  const [borrower, setBorrower] = useState(null)
  const [loans, setLoans] = useState([])
  const [paymentTotals, setPaymentTotals] = useState({})
  const [smsLogs, setSmsLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSms, setActiveSms] = useState(null) // { loanId?, borrowerId?, smsType? } | null
  const [historyLoan, setHistoryLoan] = useState(null)
  const [historyPayments, setHistoryPayments] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [b, l, sms] = await Promise.all([
      getBorrower(id),
      listLoansForBorrower(id),
      listSmsLogsForBorrower(id)
    ])
    setBorrower(b)
    setLoans(l)
    setSmsLogs(sms)
    setPaymentTotals(await listPaymentTotalsForLoans(l.map(loan => loan.id)))
    setLoading(false)
  }

  async function handleSmsSent() {
    setActiveSms(null)
    await load()
    alert('SMS sent successfully.')
  }

  async function openHistory(loan) {
    setHistoryLoan(loan)
    setHistoryLoading(true)
    setHistoryPayments(await listPaymentsForLoan(loan.id))
    setHistoryLoading(false)
  }

  function closeHistory() {
    setHistoryLoan(null)
    setHistoryPayments([])
  }

  function remainingFor(loan) {
    const { totalPayable } = computeLoanTotals(loan)
    const paid = paymentTotals[loan.id] || 0
    return Math.max(0, Math.round(totalPayable - paid))
  }

  if (loading || !borrower) return <p className="text-slatey text-sm">Loading…</p>

  const outstandingLoans = loans.filter(l => OUTSTANDING_STATUSES.includes(l.status))
  const totalOutstanding = outstandingLoans.reduce((s, l) => s + remainingFor(l), 0)

  return (
    <div>
      <Link to="/borrowers" className="flex items-center gap-1 text-sm text-slatey hover:text-ink mb-4 w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to borrowers
      </Link>

      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink">{borrower.full_name}</h1>
          <p className="text-sm text-slatey mt-1 stamp">{borrower.contact_number || 'No contact number on file'}</p>
        </div>
        <button
          onClick={() => setActiveSms({ borrowerId: id, smsType: 'loan_balance_summary' })}
          disabled={outstandingLoans.length === 0}
          className="flex items-center gap-2 bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark disabled:opacity-40"
        >
          <MessageSquare className="w-4 h-4" /> Send Overall Summary
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="ledger-card p-4">
          <p className="text-xl font-display text-ink">{outstandingLoans.length}</p>
          <p className="text-xs text-slatey mt-1 uppercase tracking-wide">Active Loans</p>
        </div>
        <div className="ledger-card p-4">
          <p className="text-xl font-display text-ink">₱{totalOutstanding.toLocaleString()}</p>
          <p className="text-xs text-slatey mt-1 uppercase tracking-wide">Total Outstanding Balance</p>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="font-display text-lg text-ink mb-3">Loans</h2>
        {loans.length === 0 ? (
          <div className="ledger-card p-5">
            <p className="text-sm text-slatey">This borrower has no loans yet.</p>
          </div>
        ) : (
          <div className="ledger-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
                  <th className="py-3 px-4 font-medium">Loan #</th>
                  <th className="py-3 px-4 font-medium text-right">Original</th>
                  <th className="py-3 px-4 font-medium text-right">Remaining</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loans.map(loan => (
                  <tr key={loan.id} className="border-b border-ledgerline last:border-0">
                    <td className="py-3 px-4">
                      <Link to={`/loans/${loan.id}`} className="stamp text-vault hover:underline">{loan.loan_number}</Link>
                    </td>
                    <td className="py-3 px-4 text-right">₱{Number(loan.principal_amount).toLocaleString()}</td>
                    <td className="py-3 px-4 text-right">₱{remainingFor(loan).toLocaleString()}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-1 rounded ${statusColors[loan.status] || 'bg-ledger text-slatey'}`}>{loan.status}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3 justify-end text-xs">
                        <button onClick={() => openHistory(loan)} title="Payment history" className="text-slatey hover:text-vault">
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setActiveSms({ loanId: loan.id, smsType: 'loan_balance_summary' })}
                          className="text-vault hover:underline"
                        >
                          Balance Summary
                        </button>
                        <button
                          onClick={() => setActiveSms({ loanId: loan.id, borrowerId: id })}
                          className="text-vault hover:underline"
                        >
                          Send SMS
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ledger-card overflow-hidden">
        <div className="px-5 py-3 border-b border-ledgerline">
          <h2 className="font-display text-lg text-ink">SMS History</h2>
        </div>
        {smsLogs.length === 0 ? (
          <p className="text-sm text-slatey p-5">No SMS sent for this borrower yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
                  <th className="py-2 px-4 font-medium">Date</th>
                  <th className="py-2 px-4 font-medium">Loan</th>
                  <th className="py-2 px-4 font-medium">Type</th>
                  <th className="py-2 px-4 font-medium">Message</th>
                  <th className="py-2 px-4 font-medium">Status</th>
                  <th className="py-2 px-4 font-medium">Sent By</th>
                </tr>
              </thead>
              <tbody>
                {smsLogs.map(log => (
                  <tr key={log.id} className="border-b border-ledgerline last:border-0">
                    <td className="py-2 px-4 text-slatey whitespace-nowrap">
                      {new Date(log.created).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="py-2 px-4 text-slatey stamp">{log.loans?.loan_number || 'All loans'}</td>
                    <td className="py-2 px-4 text-slatey">
                      {SMS_TYPES.find(t => t.value === log.sms_type)?.label || log.sms_type}
                    </td>
                    <td className="py-2 px-4 text-ink max-w-xs truncate" title={log.message}>{log.message}</td>
                    <td className="py-2 px-4">
                      <span className={`text-xs px-2 py-1 rounded ${smsStatusColors[log.status] || 'bg-ledger text-slatey'}`}>
                        {log.status}
                      </span>
                      {log.status === 'failed' && log.error_message && (
                        <span className="block text-xs text-rust mt-0.5">{log.error_message}</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-slatey">{log.sent_by_email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historyLoan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={closeHistory} />
          <div className="relative ledger-card w-full max-w-lg max-h-[80vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg text-ink">
                Payment History <span className="stamp text-vault">{historyLoan.loan_number}</span>
              </h2>
              <button onClick={closeHistory} className="text-slatey hover:text-ink" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            {historyLoading ? (
              <p className="text-sm text-slatey">Loading…</p>
            ) : historyPayments.length === 0 ? (
              <p className="text-sm text-slatey">No payments recorded for this loan yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Method</th>
                    <th className="py-2 font-medium">Received By</th>
                    <th className="py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {historyPayments.map(p => (
                    <tr key={p.id} className="border-b border-ledgerline last:border-0">
                      <td className="py-2 text-slatey">{p.payment_date?.slice(0, 10)}</td>
                      <td className="py-2 text-slatey capitalize">{p.payment_method || '—'}</td>
                      <td className="py-2 text-slatey">{p.received_by || '—'}</td>
                      <td className="py-2 text-right">₱{Number(p.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeSms && (
        <SmsModal
          loanId={activeSms.loanId}
          borrowerId={activeSms.borrowerId}
          smsType={activeSms.smsType}
          onClose={() => setActiveSms(null)}
          onSent={handleSmsSent}
        />
      )}
    </div>
  )
}
