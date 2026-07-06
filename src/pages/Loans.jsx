import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listLoans, listBorrowers, listGroups, createLoan, updateLoan,
  softDeleteLoan, restoreLoan, insertSchedule, deleteScheduleForLoan,
  listPaymentsForLoan
} from '../lib/api'
import { generateSchedule, computeLoanTotals } from '../lib/loanCalculations'
import { Plus, Pencil, Trash2, RotateCcw } from 'lucide-react'

const emptyForm = {
  borrowerType: 'individual',
  borrower_id: '',
  group_id: '',
  principal_amount: '',
  interest_rate: '',
  interest_method: 'flat',
  term_months: '',
  repayment_frequency: 'monthly',
  disbursement_date: '',
  purpose: ''
}

const statusColors = {
  pending: 'bg-ledger text-slatey',
  active: 'bg-moss/10 text-moss',
  completed: 'bg-vault/10 text-vault',
  defaulted: 'bg-rust/10 text-rust',
  written_off: 'bg-rust/10 text-rust'
}

// Fields that trigger a schedule regeneration when changed (only checked
// pre-payment — see financialsChanged below). Term and repayment frequency
// stay editable even after payments exist (see disabled= usage below), but
// still count toward "did financials change" so pre-payment edits still
// regenerate the schedule correctly.
const FINANCIAL_FIELDS = ['principal_amount', 'interest_rate', 'interest_method', 'term_months', 'repayment_frequency', 'disbursement_date']

export default function Loans() {
  const [loans, setLoans] = useState([])
  const [borrowers, setBorrowers] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  // When editing: the loan being edited, plus whether it already has payments
  // (financial terms are locked then, since the schedule can't be regenerated).
  const [editing, setEditing] = useState(null)
  const [editingHasPayments, setEditingHasPayments] = useState(false)

  useEffect(() => { load() }, [showDeleted])

  async function load() {
    setLoading(true)
    const [l, b, g] = await Promise.all([listLoans({ includeDeleted: showDeleted }), listBorrowers(), listGroups()])
    setLoans(l)
    setBorrowers(b)
    setGroups(g)
    setLoading(false)
  }

  function nextLoanNumber() {
    const year = new Date().getFullYear()
    return `LN-${year}-${String(loans.length + 1).padStart(4, '0')}`
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setForm(emptyForm)
  }

  async function startEdit(loan) {
    const payments = await listPaymentsForLoan(loan.id)
    setEditingHasPayments(payments.length > 0)
    setEditing(loan)
    setForm({
      borrowerType: loan.group_id ? 'group' : 'individual',
      borrower_id: loan.borrower_id || '',
      group_id: loan.group_id || '',
      principal_amount: String(loan.principal_amount),
      interest_rate: String(loan.interest_rate),
      interest_method: loan.interest_method,
      term_months: String(loan.term_months),
      repayment_frequency: loan.repayment_frequency,
      disbursement_date: loan.disbursement_date ? loan.disbursement_date.slice(0, 10) : '',
      purpose: loan.purpose || ''
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        await handleUpdate()
      } else {
        await handleCreate()
      }
      closeForm()
      await load()
    } catch (err) {
      alert(err.message)
    }
    setSaving(false)
  }

  async function handleCreate() {
    const loanPayload = {
      loan_number: nextLoanNumber(),
      borrower_id: form.borrowerType === 'individual' ? form.borrower_id : null,
      group_id: form.borrowerType === 'group' ? form.group_id : null,
      principal_amount: Number(form.principal_amount),
      interest_rate: Number(form.interest_rate),
      interest_method: form.interest_method,
      term_months: Number(form.term_months),
      repayment_frequency: form.repayment_frequency,
      disbursement_date: form.disbursement_date || null,
      purpose: form.purpose,
      status: form.disbursement_date ? 'active' : 'pending'
    }
    const loan = await createLoan(loanPayload)

    if (form.disbursement_date) {
      const schedule = generateSchedule({
        principal: loanPayload.principal_amount,
        interestRate: loanPayload.interest_rate,
        interestMethod: loanPayload.interest_method,
        termMonths: loanPayload.term_months,
        frequency: loanPayload.repayment_frequency,
        disbursementDate: loanPayload.disbursement_date
      })
      await insertSchedule(loan.id, schedule)
    }
  }

  async function handleUpdate() {
    // Borrower/group is intentionally never sent — it's locked once a loan exists.
    const updates = {
      purpose: form.purpose,
      term_months: Number(form.term_months),
      repayment_frequency: form.repayment_frequency
    }

    const financialsChanged = !editingHasPayments && FINANCIAL_FIELDS.some(f => {
      const oldVal = f === 'disbursement_date'
        ? (editing.disbursement_date ? editing.disbursement_date.slice(0, 10) : '')
        : String(editing[f] ?? '')
      return String(form[f]) !== oldVal
    })

    if (!editingHasPayments) {
      updates.principal_amount = Number(form.principal_amount)
      updates.interest_rate = Number(form.interest_rate)
      updates.interest_method = form.interest_method
      updates.disbursement_date = form.disbursement_date || null
      updates.status = form.disbursement_date
        ? (editing.status === 'pending' ? 'active' : editing.status)
        : 'pending'
    }

    await updateLoan(editing.id, updates)

    // Financial terms changed and no payments recorded yet — rebuild the schedule.
    if (financialsChanged) {
      await deleteScheduleForLoan(editing.id)
      if (form.disbursement_date) {
        const schedule = generateSchedule({
          principal: Number(form.principal_amount),
          interestRate: Number(form.interest_rate),
          interestMethod: form.interest_method,
          termMonths: Number(form.term_months),
          frequency: form.repayment_frequency,
          disbursementDate: form.disbursement_date
        })
        await insertSchedule(editing.id, schedule)
      }
    }
  }

  async function handleDelete(loan) {
    if (!confirm(`Delete loan ${loan.loan_number}? It will be hidden but can be restored via "Show deleted".`)) return
    try {
      await softDeleteLoan(loan)
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleRestore(loan) {
    try {
      await restoreLoan(loan)
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl text-ink">Loans</h1>
          <p className="text-sm text-slatey mt-1">Individual and group loans, disbursement, and status.</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm text-slatey cursor-pointer">
            <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} />
            Show deleted
          </label>
          <button
            onClick={() => (showForm ? closeForm() : setShowForm(true))}
            className="flex items-center gap-2 bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark transition"
          >
            <Plus className="w-4 h-4" /> New Loan
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="ledger-card p-5 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {editing && (
            <p className="col-span-2 text-sm text-ink">
              Editing loan <span className="stamp text-vault">{editing.loan_number}</span>
              {editingHasPayments && (
                <span className="text-xs text-rust ml-2">
                  Payments exist on this loan — principal, rate, method, and disbursement date are locked.
                </span>
              )}
            </p>
          )}

          {editing ? (
            <div className="col-span-2">
              <label className="block text-xs uppercase tracking-wide text-slatey mb-1">
                {editing.group_id ? 'Group' : 'Borrower'}
              </label>
              <p className="w-full border border-ledgerline rounded px-3 py-2 text-sm bg-ledger text-slatey">
                {editing.borrowers?.full_name || editing.borrower_groups?.group_name || '—'}
                <span className="text-xs ml-2">(cannot be changed after a loan is created)</span>
              </p>
            </div>
          ) : (
            <>
              <div className="col-span-2 flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={form.borrowerType === 'individual'} onChange={() => setForm({ ...form, borrowerType: 'individual' })} />
                  Individual loan
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={form.borrowerType === 'group'} onChange={() => setForm({ ...form, borrowerType: 'group' })} />
                  Group loan
                </label>
              </div>

              {form.borrowerType === 'individual' ? (
                <Select label="Borrower" value={form.borrower_id} onChange={v => setForm({ ...form, borrower_id: v })} required
                  options={borrowers.map(b => ({ value: b.id, label: b.full_name }))} />
              ) : (
                <Select label="Group" value={form.group_id} onChange={v => setForm({ ...form, group_id: v })} required
                  options={groups.map(g => ({ value: g.id, label: g.group_name }))} />
              )}
            </>
          )}

          <Field label="Principal Amount (₱)" type="number" value={form.principal_amount} onChange={v => setForm({ ...form, principal_amount: v })} required disabled={editingHasPayments && !!editing} />
          <Field label="Interest Rate (% per term)" type="number" step="0.01" value={form.interest_rate} onChange={v => setForm({ ...form, interest_rate: v })} required disabled={editingHasPayments && !!editing} />
          <Select label="Interest Method" value={form.interest_method} onChange={v => setForm({ ...form, interest_method: v })} disabled={editingHasPayments && !!editing}
            options={[{ value: 'flat', label: 'Flat rate' }, { value: 'declining', label: 'Declining balance' }]} />
          <Field label="Term (months)" type="number" value={form.term_months} onChange={v => setForm({ ...form, term_months: v })} required />
          <Select label="Repayment Frequency" value={form.repayment_frequency} onChange={v => setForm({ ...form, repayment_frequency: v })}
            options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Biweekly' }, { value: 'monthly', label: 'Monthly' }]} />
          <Field label="Disbursement Date" type="date" value={form.disbursement_date} onChange={v => setForm({ ...form, disbursement_date: v })} disabled={editingHasPayments && !!editing} />
          <Field label="Purpose" value={form.purpose} onChange={v => setForm({ ...form, purpose: v })} placeholder="e.g. Working capital" />

          <p className="col-span-2 text-xs text-slatey -mt-2">
            {editing
              ? editingHasPayments
                ? 'Term and repayment frequency can still be changed, but won’t regenerate the already-paid schedule automatically.'
                : 'Changing financial terms regenerates the repayment schedule.'
              : 'Leave disbursement date blank to save as "pending". Setting it generates the repayment schedule automatically.'}
          </p>

          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={closeForm} className="px-4 py-2 text-sm text-slatey">Cancel</button>
            <button type="submit" disabled={saving} className="bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark disabled:opacity-60">
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Loan'}
            </button>
          </div>
        </form>
      )}

      <div className="ledger-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
              <th className="py-3 px-4 font-medium">Loan #</th>
              <th className="py-3 px-4 font-medium">Borrower / Group</th>
              <th className="py-3 px-4 font-medium text-right">Principal</th>
              <th className="py-3 px-4 font-medium text-right">Principal + Interest</th>
              <th className="py-3 px-4 font-medium">Term</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-6 px-4 text-slatey">Loading…</td></tr>
            ) : loans.length === 0 ? (
              <tr><td colSpan={7} className="py-6 px-4 text-slatey">No loans yet. Create one above.</td></tr>
            ) : loans.map(l => (
              <tr key={l.id} className={`border-b border-ledgerline last:border-0 hover:bg-ledger/30 ${l.deleted ? 'opacity-60' : ''}`}>
                <td className="py-3 px-4">
                  <Link to={`/loans/${l.id}`} className="stamp text-vault hover:underline">{l.loan_number}</Link>
                  {l.deleted && <span className="text-[10px] uppercase tracking-wide text-rust ml-2">deleted</span>}
                </td>
                <td className="py-3 px-4">{l.borrowers?.full_name || l.borrower_groups?.group_name || '—'}</td>
                <td className="py-3 px-4 text-right">₱{Number(l.principal_amount).toLocaleString()}</td>
                <td className="py-3 px-4 text-right">₱{computeLoanTotals(l).totalPayable.toLocaleString()}</td>
                <td className="py-3 px-4 text-slatey">{l.term_months} mo · {l.repayment_frequency}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-1 rounded ${statusColors[l.status] || 'bg-ledger text-slatey'}`}>{l.status}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 justify-end">
                    {l.deleted ? (
                      <button onClick={() => handleRestore(l)} title="Restore loan" className="flex items-center gap-1 text-xs text-vault hover:underline">
                        <RotateCcw className="w-3.5 h-3.5" /> Restore
                      </button>
                    ) : (
                      <>
                        <button onClick={() => startEdit(l)} title="Edit loan" className="text-slatey hover:text-vault">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(l)} title="Delete loan" className="text-slatey hover:text-rust">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required, placeholder, step, disabled }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slatey mb-1">{label}</label>
      <input
        type={type}
        step={step}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30 disabled:bg-ledger disabled:text-slatey"
      />
    </div>
  )
}

function Select({ label, value, onChange, options, required, disabled }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slatey mb-1">{label}</label>
      <select
        required={required}
        disabled={disabled}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30 disabled:bg-ledger disabled:text-slatey"
      >
        <option value="">Select…</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
