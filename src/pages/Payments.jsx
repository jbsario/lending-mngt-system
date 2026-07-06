import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRecentPayments, listLoans, recordLoanPayment } from '../lib/api'
import { Plus } from 'lucide-react'

const emptyForm = {
  loan_id: '',
  amount: '',
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'cash',
  received_by: '',
  notes: ''
}

export default function Payments() {
  const [payments, setPayments] = useState([])
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, l] = await Promise.all([listRecentPayments(200), listLoans()])
    setPayments(p)
    // Only loans that can still take a payment make sense in the picker.
    setLoans(l.filter(loan => loan.status === 'active' || loan.status === 'defaulted'))
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const loan = loans.find(l => l.id === form.loan_id)
    if (!loan) return
    setSaving(true)
    setNotice('')
    try {
      const result = await recordLoanPayment({
        loan,
        amount: Number(form.amount),
        payment_date: form.payment_date,
        payment_method: form.payment_method,
        received_by: form.received_by,
        notes: form.notes
      })
      const parts = [`Payment recorded across ${result.allocations.length} installment${result.allocations.length === 1 ? '' : 's'}.`]
      if (result.loanCompleted) parts.push(`Loan ${loan.loan_number} is now fully paid and marked completed.`)
      if (result.unallocated > 0) parts.push(`₱${result.unallocated.toLocaleString()} exceeded the balance and was left unallocated.`)
      setNotice(parts.join(' '))
      setForm({ ...emptyForm, payment_date: form.payment_date })
      setShowForm(false)
      await load()
    } catch (err) {
      alert(err.message)
    }
    setSaving(false)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl text-ink">Payments</h1>
          <p className="text-sm text-slatey mt-1">Full payment history across all loans.</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark transition"
        >
          <Plus className="w-4 h-4" /> Record Payment
        </button>
      </div>

      {notice && (
        <div className="text-sm text-moss bg-moss/10 border border-moss/20 rounded px-3 py-2 mb-4">{notice}</div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="ledger-card p-5 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Loan</label>
            <select
              required
              value={form.loan_id}
              onChange={e => setForm({ ...form, loan_id: e.target.value })}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            >
              <option value="">Select a loan…</option>
              {loans.map(l => (
                <option key={l.id} value={l.id}>
                  {l.loan_number} — {l.borrowers?.full_name || l.borrower_groups?.group_name || '—'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Amount (₱)</label>
            <input
              type="number" step="0.01" min="0.01" required
              value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Payment Date</label>
            <input
              type="date" required
              value={form.payment_date}
              onChange={e => setForm({ ...form, payment_date: e.target.value })}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Method</label>
            <select
              value={form.payment_method}
              onChange={e => setForm({ ...form, payment_method: e.target.value })}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            >
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="bank transfer">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Received By</label>
            <input
              value={form.received_by}
              onChange={e => setForm({ ...form, received_by: e.target.value })}
              placeholder="Staff name"
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Notes</label>
            <input
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            />
          </div>
          <p className="col-span-2 text-xs text-slatey -mt-2">
            The amount is applied to the earliest unpaid installments first. When everything is settled the loan is marked completed automatically.
          </p>
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slatey">Cancel</button>
            <button type="submit" disabled={saving} className="bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark disabled:opacity-60">
              {saving ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </form>
      )}

      <div className="ledger-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
              <th className="py-3 px-4 font-medium">Date</th>
              <th className="py-3 px-4 font-medium">Loan #</th>
              <th className="py-3 px-4 font-medium">Borrower</th>
              <th className="py-3 px-4 font-medium">Method</th>
              <th className="py-3 px-4 font-medium">Received By</th>
              <th className="py-3 px-4 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-6 px-4 text-slatey">Loading…</td></tr>
            ) : payments.length === 0 ? (
              <tr><td colSpan={6} className="py-6 px-4 text-slatey">No payments recorded yet.</td></tr>
            ) : payments.map(p => (
              <tr key={p.id} className="border-b border-ledgerline last:border-0">
                <td className="py-3 px-4 text-slatey">{p.payment_date?.slice(0, 10)}</td>
                <td className="py-3 px-4">
                  <Link to={`/loans/${p.loan_id}`} className="stamp text-vault hover:underline">{p.loans?.loan_number}</Link>
                </td>
                <td className="py-3 px-4">{p.loans?.borrowers?.full_name || '—'}</td>
                <td className="py-3 px-4 text-slatey capitalize">{p.payment_method || '—'}</td>
                <td className="py-3 px-4 text-slatey">{p.received_by || '—'}</td>
                <td className="py-3 px-4 text-right">₱{Number(p.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
