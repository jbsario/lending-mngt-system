import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getLoan, listScheduleForLoan, updateScheduleRow, recordPayment,
  listDocuments, uploadDocument, getDocumentUrl, deleteDocument
} from '../lib/api'
import { summarizeLoan } from '../lib/loanCalculations'
import { ArrowLeft, Upload, FileText, Trash2, CheckCircle2 } from 'lucide-react'

const scheduleStatusColors = {
  unpaid: 'bg-ledger text-slatey',
  partial: 'bg-brass/10 text-brassdark',
  paid: 'bg-moss/10 text-moss',
  overdue: 'bg-rust/10 text-rust'
}

export default function LoanDetail() {
  const { id } = useParams()
  const [loan, setLoan] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [payingRow, setPayingRow] = useState(null)
  const [payAmount, setPayAmount] = useState('')

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [l, s, d] = await Promise.all([
      getLoan(id),
      listScheduleForLoan(id),
      listDocuments({ loanId: id })
    ])
    setLoan(l)
    setSchedule(s)
    setDocuments(d)
    setLoading(false)
  }

  async function handleRecordPayment(row) {
    const amount = Number(payAmount)
    if (!amount || amount <= 0) return
    try {
      await recordPayment({
        loan_id: id,
        loan_number: loan.loan_number,
        schedule_id: row.id,
        amount,
        payment_date: new Date().toISOString().slice(0, 10),
        payment_method: 'cash'
      })
      const newPaid = Number(row.amount_paid) + amount
      const newStatus = newPaid >= Number(row.total_due) ? 'paid' : 'partial'
      await updateScheduleRow(row.id, { amount_paid: newPaid, status: newStatus })
      setPayingRow(null)
      setPayAmount('')
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleUpload(file, docType) {
    try {
      await uploadDocument({ file, borrowerId: loan.borrower_id, loanId: id, docType })
      await load()
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
    await load()
  }

  if (loading || !loan) return <p className="text-slatey text-sm">Loading…</p>

  const summary = summarizeLoan(schedule)

  return (
    <div>
      <Link to="/loans" className="flex items-center gap-1 text-sm text-slatey hover:text-ink mb-4 w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to loans
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl text-ink stamp">{loan.loan_number}</h1>
          <p className="text-sm text-slatey mt-1">
            {loan.borrowers?.full_name || loan.borrower_groups?.group_name} · {loan.purpose || 'No purpose noted'}
          </p>
        </div>
        <span className="text-xs px-2 py-1 rounded bg-ledger border border-ledgerline text-slatey">{loan.status}</span>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <Stat label="Principal" value={`₱${Number(loan.principal_amount).toLocaleString()}`} />
        <Stat label="Total Due" value={`₱${summary.totalDue.toLocaleString()}`} />
        <Stat label="Total Paid" value={`₱${summary.totalPaid.toLocaleString()}`} />
        <Stat label="Balance" value={`₱${summary.balance.toLocaleString()}`} alert={summary.balance > 0 && summary.overdueCount > 0} />
      </div>

      <div className="ledger-card mb-8 overflow-hidden">
        <div className="px-5 py-3 border-b border-ledgerline">
          <h2 className="font-display text-lg text-ink">Repayment Schedule</h2>
        </div>
        {schedule.length === 0 ? (
          <p className="text-sm text-slatey p-5">No schedule generated. This loan may still be pending disbursement.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
                <th className="py-2 px-4 font-medium">#</th>
                <th className="py-2 px-4 font-medium">Due Date</th>
                <th className="py-2 px-4 font-medium text-right">Total Due</th>
                <th className="py-2 px-4 font-medium text-right">Paid</th>
                <th className="py-2 px-4 font-medium">Status</th>
                <th className="py-2 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map(row => (
                <tr key={row.id} className="border-b border-ledgerline last:border-0">
                  <td className="py-2 px-4 text-slatey">{row.installment_number}</td>
                  <td className="py-2 px-4">{row.due_date}</td>
                  <td className="py-2 px-4 text-right">₱{Number(row.total_due).toLocaleString()}</td>
                  <td className="py-2 px-4 text-right">₱{Number(row.amount_paid).toLocaleString()}</td>
                  <td className="py-2 px-4">
                    <span className={`text-xs px-2 py-1 rounded ${scheduleStatusColors[row.status]}`}>{row.status}</span>
                  </td>
                  <td className="py-2 px-4 text-right">
                    {row.status === 'paid' ? (
                      <CheckCircle2 className="w-4 h-4 text-moss inline" />
                    ) : payingRow === row.id ? (
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                          autoFocus
                          value={payAmount}
                          onChange={e => setPayAmount(e.target.value)}
                          placeholder="Amount"
                          className="w-24 border border-ledgerline rounded px-2 py-1 text-xs"
                        />
                        <button onClick={() => handleRecordPayment(row)} className="text-xs bg-vault text-white px-2 py-1 rounded">Save</button>
                        <button onClick={() => setPayingRow(null)} className="text-xs text-slatey px-1">✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setPayingRow(row.id); setPayAmount(String(Number(row.total_due) - Number(row.amount_paid))) }}
                        className="text-xs text-vault hover:underline"
                      >
                        Record payment
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ledger-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg text-ink">Documents</h2>
          <UploadButton onFile={handleUpload} />
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-slatey">No documents uploaded for this loan yet.</p>
        ) : (
          <ul className="divide-y divide-ledgerline text-sm">
            {documents.map(doc => (
              <li key={doc.id} className="flex items-center justify-between py-2.5">
                <button onClick={() => handleViewDoc(doc)} className="flex items-center gap-2 text-ink hover:text-vault">
                  <FileText className="w-4 h-4 text-slatey" />
                  {doc.file_name}
                  <span className="text-xs text-slatey stamp">{doc.doc_type}</span>
                </button>
                <button onClick={() => handleDeleteDoc(doc)} className="text-slatey hover:text-rust">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, alert }) {
  return (
    <div className="ledger-card p-4">
      <p className={`text-xl font-display ${alert ? 'text-rust' : 'text-ink'}`}>{value}</p>
      <p className="text-xs text-slatey mt-1 uppercase tracking-wide">{label}</p>
    </div>
  )
}

function UploadButton({ onFile }) {
  const [docType, setDocType] = useState('Loan Agreement')
  return (
    <div className="flex items-center gap-2">
      <select value={docType} onChange={e => setDocType(e.target.value)} className="border border-ledgerline rounded px-2 py-1.5 text-xs">
        <option>Loan Agreement</option>
        <option>ID</option>
        <option>Collateral</option>
        <option>Other</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm bg-vault text-white px-3 py-1.5 rounded cursor-pointer hover:bg-vaultdark">
        <Upload className="w-3.5 h-3.5" /> Upload
        <input type="file" className="hidden" onChange={e => { if (e.target.files[0]) onFile(e.target.files[0], docType) }} />
      </label>
    </div>
  )
}
