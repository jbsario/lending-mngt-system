import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { previewLoanSms, sendLoanSms } from '../services/smsService'

export const SMS_TYPES = [
  { value: 'payment_reminder', label: 'Payment Reminder' },
  { value: 'due_date_reminder', label: 'Due Date Reminder' },
  { value: 'payment_received', label: 'Payment Received' },
  { value: 'overdue_notice', label: 'Overdue Notice' },
  { value: 'loan_approval', label: 'Loan Approval' },
  { value: 'loan_balance_summary', label: 'Balance Summary' }
]

// Preview → confirm → send modal, shared by LoanDetail.jsx (loanId + a
// pre-chosen smsType — no picker) and BorrowerDetail.jsx (loanId +
// borrowerId, no smsType — shows a type picker, and once "Balance Summary"
// is picked, a Summary Scope radio for This Loan vs All Active Loans).
// The scope choice is only ever a UI convenience — which of loanId/
// borrowerId actually gets sent to the Edge Function is what determines
// scope server-side, never a client-sent flag.
export default function SmsModal({ loanId, borrowerId, smsType, onClose, onSent }) {
  const typeIsLocked = !!smsType
  const [selectedType, setSelectedType] = useState(smsType || SMS_TYPES[0].value)
  const canChooseScope = selectedType === 'loan_balance_summary' && !!loanId && !!borrowerId
  const [scope, setScope] = useState('loan')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const useBorrowerScope = canChooseScope && scope === 'borrower'
  const targetLoanId = useBorrowerScope ? undefined : (loanId || undefined)
  const targetBorrowerId = useBorrowerScope || !loanId ? borrowerId : undefined

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPreview(null)
    previewLoanSms({ loanId: targetLoanId, borrowerId: targetBorrowerId, smsType: selectedType })
      .then(p => { if (!cancelled) setPreview(p) })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, scope, loanId, borrowerId])

  async function handleSend() {
    setSending(true)
    setError('')
    try {
      await sendLoanSms({ loanId: targetLoanId, borrowerId: targetBorrowerId, smsType: selectedType })
      onSent?.()
    } catch (err) {
      setError(err.message)
      setSending(false)
    }
  }

  const typeLabel = SMS_TYPES.find(t => t.value === selectedType)?.label || selectedType

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={() => !sending && onClose()} />
      <div className="relative ledger-card w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg text-ink">Send {typeLabel}?</h2>
          <button onClick={() => !sending && onClose()} className="text-slatey hover:text-ink" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!typeIsLocked && (
          <div className="mb-3">
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">SMS Type</label>
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            >
              {SMS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}

        {canChooseScope && (
          <div className="mb-3">
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Summary Scope</label>
            <div className="flex items-center gap-4 text-sm text-ink">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={scope === 'loan'} onChange={() => setScope('loan')} /> This Loan
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={scope === 'borrower'} onChange={() => setScope('borrower')} /> All Active Loans
              </label>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slatey py-4">Loading preview…</p>
        ) : error ? (
          <p className="text-sm text-rust py-2">{error}</p>
        ) : preview ? (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slatey mb-0.5">Borrower</p>
              <p className="text-ink">{preview.borrower_name}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slatey mb-0.5">Mobile</p>
              <p className="text-ink stamp">{preview.phone}</p>
            </div>
            {preview.scope === 'loan' && preview.loan_number && (
              <div>
                <p className="text-xs uppercase tracking-wide text-slatey mb-0.5">Loan</p>
                <p className="text-ink stamp">{preview.loan_number}</p>
              </div>
            )}
            {preview.scope === 'borrower' && (
              <div>
                <p className="text-xs uppercase tracking-wide text-slatey mb-0.5">Scope</p>
                <p className="text-ink">All Active Loans ({preview.active_loans})</p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wide text-slatey mb-0.5">Message</p>
              <p className="ledger-card bg-ledger/40 p-3 text-ink">{preview.message}</p>
            </div>
          </div>
        ) : null}

        <div className="flex gap-2 justify-end mt-5">
          <button onClick={() => !sending && onClose()} disabled={sending} className="px-4 py-2 text-sm text-slatey disabled:opacity-60">
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || loading || !!error || !preview}
            className="bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </div>
    </div>
  )
}
