import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listLoans, listBorrowers, listGroups, createLoan, updateLoan,
  softDeleteLoan, restoreLoan, insertSchedule, deleteScheduleForLoan,
  regenerateRemainderSchedule,
  listPaymentsForLoan, listPaymentTotalsForLoans,
  uploadDocument, listDocuments, getDocumentUrl, deleteDocument
} from '../lib/api'
import { generateSchedule, computeLoanTotals } from '../lib/loanCalculations'
import { Plus, Pencil, Trash2, RotateCcw, History, Upload, FileText, X } from 'lucide-react'

const emptyForm = {
  borrowerType: 'individual',
  borrower_id: '',
  group_id: '',
  principal_amount: '',
  interest_rate: '',
  interest_method: 'flat',
  term_months: '',
  repayment_frequency: 'monthly',
  payment_weekday: '',
  disbursement_date: '',
  purpose: ''
}

const WEEKDAY_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' }
]

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
const FINANCIAL_FIELDS = ['principal_amount', 'interest_rate', 'interest_method', 'term_months', 'repayment_frequency', 'payment_weekday', 'disbursement_date']

export default function Loans() {
  const [loans, setLoans] = useState([])
  const [borrowers, setBorrowers] = useState([])
  const [groups, setGroups] = useState([])
  const [paymentTotals, setPaymentTotals] = useState({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  // When editing: the loan being edited, plus whether it already has payments
  // (financial terms are locked then, since the schedule can't be regenerated).
  const [editing, setEditing] = useState(null)
  const [editingHasPayments, setEditingHasPayments] = useState(false)
  const [editingDocuments, setEditingDocuments] = useState([])
  const [docType, setDocType] = useState('Loan Agreement')
  const [docFile, setDocFile] = useState(null)
  const [historyLoan, setHistoryLoan] = useState(null)
  const [historyPayments, setHistoryPayments] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => { load() }, [showDeleted])

  async function load() {
    setLoading(true)
    const [l, b, g] = await Promise.all([listLoans({ includeDeleted: showDeleted }), listBorrowers(), listGroups()])
    setLoans(l)
    setBorrowers(b)
    setGroups(g)
    setPaymentTotals(await listPaymentTotalsForLoans(l.map(x => x.id)))
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
    setDocType('Loan Agreement')
    setDocFile(null)
    setEditingDocuments([])
  }

  async function startEdit(loan) {
    const [payments, docs] = await Promise.all([listPaymentsForLoan(loan.id), listDocuments({ loanId: loan.id })])
    setEditingHasPayments(payments.length > 0)
    setEditingDocuments(docs)
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
      payment_weekday: loan.payment_weekday != null ? String(loan.payment_weekday) : '',
      disbursement_date: loan.disbursement_date ? loan.disbursement_date.slice(0, 10) : '',
      purpose: loan.purpose || ''
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      let cancelled = false
      if (editing) {
        cancelled = await handleUpdate()
      } else {
        await handleCreate()
      }
      if (!cancelled) {
        closeForm()
        await load()
      }
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
      payment_weekday: form.payment_weekday !== '' ? Number(form.payment_weekday) : null,
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
        disbursementDate: loanPayload.disbursement_date,
        paymentWeekday: loanPayload.payment_weekday
      })
      await insertSchedule(loan.id, schedule)
    }

    if (docFile) {
      await uploadDocument({ file: docFile, borrowerId: loanPayload.borrower_id, loanId: loan.id, docType })
    }
  }

  // Returns true if the user backed out of a confirmation, so handleSubmit
  // knows not to close the form / reload as if a save happened.
  async function handleUpdate() {
    const scheduleShapeFields = ['term_months', 'repayment_frequency', 'payment_weekday']
    const scheduleShapeChanged = editingHasPayments && scheduleShapeFields.some(f => {
      const oldVal = String(editing[f] ?? '')
      return String(form[f]) !== oldVal
    })

    if (scheduleShapeChanged) {
      const ok = confirm(
        'This loan already has payments recorded. Changing term, frequency, or payment day will replace its remaining unpaid installments with a fresh schedule for the outstanding balance — already-paid installments are kept exactly as they are. Continue?'
      )
      if (!ok) return true
    }

    // Borrower/group is intentionally never sent — it's locked once a loan exists.
    const updates = {
      purpose: form.purpose,
      term_months: Number(form.term_months),
      repayment_frequency: form.repayment_frequency,
      payment_weekday: form.payment_weekday !== '' ? Number(form.payment_weekday) : null
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

    if (!editingHasPayments && financialsChanged) {
      // No payments yet — completely safe to rebuild the whole schedule.
      await deleteScheduleForLoan(editing.id)
      if (form.disbursement_date) {
        const schedule = generateSchedule({
          principal: Number(form.principal_amount),
          interestRate: Number(form.interest_rate),
          interestMethod: form.interest_method,
          termMonths: Number(form.term_months),
          frequency: form.repayment_frequency,
          disbursementDate: form.disbursement_date,
          paymentWeekday: form.payment_weekday !== '' ? Number(form.payment_weekday) : null
        })
        await insertSchedule(editing.id, schedule)
      }
    } else if (scheduleShapeChanged) {
      // Payments already exist — only replace what's still unpaid.
      await regenerateRemainderSchedule(editing.id, {
        termMonths: Number(form.term_months),
        frequency: form.repayment_frequency,
        paymentWeekday: form.payment_weekday !== '' ? Number(form.payment_weekday) : null
      })
    }

    if (docFile) {
      await uploadDocument({ file: docFile, borrowerId: editing.borrower_id, loanId: editing.id, docType })
    }

    return false
  }

  async function handleEditUpload(file, type) {
    try {
      const doc = await uploadDocument({ file, borrowerId: editing.borrower_id, loanId: editing.id, docType: type })
      setEditingDocuments(docs => [doc, ...docs])
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleViewDoc(doc) {
    try {
      const url = await getDocumentUrl(doc)
      window.open(url, '_blank')
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleDeleteDoc(doc) {
    if (!confirm('Delete this document?')) return
    await deleteDocument(doc)
    setEditingDocuments(docs => docs.filter(d => d.id !== doc.id))
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
          {(form.repayment_frequency === 'weekly' || form.repayment_frequency === 'biweekly') && (
            <Select label="Payment Day" value={form.payment_weekday} onChange={v => setForm({ ...form, payment_weekday: v })}
              options={WEEKDAY_OPTIONS} />
          )}
          <Field label="Disbursement Date" type="date" value={form.disbursement_date} onChange={v => setForm({ ...form, disbursement_date: v })} disabled={editingHasPayments && !!editing} />
          <Field label="Purpose" value={form.purpose} onChange={v => setForm({ ...form, purpose: v })} placeholder="e.g. Working capital" />

          <div className="col-span-2">
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">
              {editing ? 'Upload Document' : 'Upload Document (optional)'}
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={docType}
                onChange={e => setDocType(e.target.value)}
                className="border border-ledgerline rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
              >
                <option>Loan Agreement</option>
                <option>ID</option>
                <option>Collateral</option>
                <option>Other</option>
              </select>
              {editing ? (
                <label className="flex items-center gap-1.5 text-sm bg-vault text-white px-3 py-2 rounded cursor-pointer hover:bg-vaultdark">
                  <Upload className="w-3.5 h-3.5" /> Upload now
                  <input type="file" className="hidden" onChange={e => { if (e.target.files[0]) handleEditUpload(e.target.files[0], docType) }} />
                </label>
              ) : (
                <>
                  <label className="flex items-center gap-1.5 text-sm border border-ledgerline px-3 py-2 rounded cursor-pointer hover:bg-ledger">
                    <Upload className="w-3.5 h-3.5" /> Choose file
                    <input type="file" className="hidden" onChange={e => setDocFile(e.target.files[0] || null)} />
                  </label>
                  {docFile && <span className="text-xs text-slatey">{docFile.name} — uploads once the loan is created</span>}
                </>
              )}
            </div>
            {editing && editingDocuments.length > 0 && (
              <ul className="mt-2 divide-y divide-ledgerline text-sm border border-ledgerline rounded">
                {editingDocuments.map(doc => (
                  <li key={doc.id} className="flex items-center justify-between px-3 py-1.5">
                    <button type="button" onClick={() => handleViewDoc(doc)} className="flex items-center gap-1.5 text-ink hover:text-vault">
                      <FileText className="w-3.5 h-3.5 text-slatey" />
                      {doc.file_name}
                      <span className="text-xs text-slatey stamp">{doc.doc_type}</span>
                    </button>
                    <button type="button" onClick={() => handleDeleteDoc(doc)} className="text-slatey hover:text-rust">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="col-span-2 text-xs text-slatey -mt-2">
            {editing
              ? editingHasPayments
                ? 'Changing term, frequency, or payment day replaces the remaining unpaid installments with a fresh schedule — already-paid ones are kept as-is.'
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
              <th className="py-3 px-4 font-medium text-right">Total Payment</th>
              <th className="py-3 px-4 font-medium">Term</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="py-6 px-4 text-slatey">Loading…</td></tr>
            ) : loans.length === 0 ? (
              <tr><td colSpan={8} className="py-6 px-4 text-slatey">No loans yet. Create one above.</td></tr>
            ) : loans.map(l => (
              <tr key={l.id} className={`border-b border-ledgerline last:border-0 hover:bg-ledger/30 ${l.deleted ? 'opacity-60' : ''}`}>
                <td className="py-3 px-4">
                  <Link to={`/loans/${l.id}`} className="stamp text-vault hover:underline">{l.loan_number}</Link>
                  {l.deleted && <span className="text-[10px] uppercase tracking-wide text-rust ml-2">deleted</span>}
                </td>
                <td className="py-3 px-4">{l.borrowers?.full_name || l.borrower_groups?.group_name || '—'}</td>
                <td className="py-3 px-4 text-right">₱{Number(l.principal_amount).toLocaleString()}</td>
                <td className="py-3 px-4 text-right">₱{computeLoanTotals(l).totalPayable.toLocaleString()}</td>
                <td className="py-3 px-4 text-right">₱{Number(paymentTotals[l.id] || 0).toLocaleString()}</td>
                <td className="py-3 px-4 text-slatey">
                  {l.term_months} mo · {l.repayment_frequency}
                  {l.payment_weekday != null && ` (${WEEKDAY_OPTIONS[l.payment_weekday].label})`}
                </td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-1 rounded ${statusColors[l.status] || 'bg-ledger text-slatey'}`}>{l.status}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => openHistory(l)} title="Payment history" className="text-slatey hover:text-vault">
                      <History className="w-3.5 h-3.5" />
                    </button>
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
