import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getLoan, listScheduleForLoan } from '../lib/api'
import { computeLoanTotals, computeMaturityDate } from '../lib/loanCalculations'
import { ArrowLeft, Printer } from 'lucide-react'

const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' }
const INTEREST_METHOD_LABELS = { flat: 'Flat Rate', declining: 'Declining Balance' }

function formatDate(isoDate) {
  if (!isoDate) return '_________________'
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function peso(amount) {
  return `₱${Math.round(Number(amount || 0)).toLocaleString('en-US')}`
}

export default function LoanAgreement() {
  const { id } = useParams()
  const [loan, setLoan] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [l, s] = await Promise.all([getLoan(id), listScheduleForLoan(id)])
      setLoan(l)
      setSchedule(s)
      setLoading(false)
    })()
  }, [id])

  if (loading || !loan) return <p className="text-slatey text-sm p-6">Loading…</p>

  const borrower = loan.borrowers
  const isGroup = !!loan.group_id
  const { totalInterest, totalPayable } = computeLoanTotals(loan)
  const maturityDate = computeMaturityDate(schedule)
  const firstDueDate = schedule[0]?.due_date

  return (
    <div className="agreement-page min-h-screen bg-slatey/10 print:bg-white">
      <style>{`
        @page { size: A4; margin: 18mm 16mm; }
        @media print {
          .no-print { display: none !important; }
          .agreement-page { background: #fff !important; }
          .agreement-sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 0 !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .agreement-sheet { font-family: 'Inter', sans-serif; color: #14231F; }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b border-ledgerline px-4 py-3 flex items-center justify-between">
        <Link to={`/loans/${id}`} className="flex items-center gap-1 text-sm text-slatey hover:text-ink">
          <ArrowLeft className="w-4 h-4" /> Back to loan
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark"
        >
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      <div className="agreement-sheet bg-white mx-auto my-8 print:my-0 w-[210mm] min-h-[297mm] px-[18mm] py-[16mm] shadow-lg text-[13px] leading-relaxed">
        <div className="text-center mb-6">
          <p className="text-2xl font-bold tracking-wide">JBSARIO MICROFINANCE</p>
          <p className="text-xs text-slatey mt-0.5">Loan Agreement</p>
        </div>

        <div className="flex items-center justify-between mb-6 pb-2 border-b border-black/20 text-xs">
          <span>Loan No.: <strong>{loan.loan_number}</strong></span>
          <span>Date Prepared: <strong>{formatDate(new Date().toISOString().slice(0, 10))}</strong></span>
        </div>

        <p className="mb-4">
          This Loan Agreement ("Agreement") is entered into by and between <strong>JBSARIO Microfinance</strong> ("Lender")
          and the borrower named below ("Borrower"), who agree to the terms and conditions set forth herein.
        </p>

        <h2 className="font-bold text-sm mt-5 mb-2 uppercase tracking-wide">1. Borrower Information</h2>
        {isGroup ? (
          <table className="w-full border-collapse mb-2">
            <tbody>
              <Row label="Group Name" value={loan.borrower_groups?.group_name} />
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse mb-2">
            <tbody>
              <Row label="Full Name" value={borrower?.full_name} />
              <Row label="Address" value={borrower?.address} />
              <Row label="Contact Number" value={borrower?.contact_number} />
              <Row label="Email" value={borrower?.email} />
              <Row label="ID Type / Number" value={borrower?.id_type ? `${borrower.id_type} — ${borrower.id_number || ''}` : ''} />
            </tbody>
          </table>
        )}

        <h2 className="font-bold text-sm mt-5 mb-2 uppercase tracking-wide">2. Loan Terms</h2>
        <table className="w-full border-collapse mb-2">
          <tbody>
            <Row label="Purpose of Loan" value={loan.purpose} />
            <Row label="Principal Amount" value={peso(loan.principal_amount)} />
            <Row label="Interest Rate" value={`${loan.interest_rate}% per month`} />
            <Row label="Interest Method" value={INTEREST_METHOD_LABELS[loan.interest_method] || loan.interest_method} />
            <Row label="Loan Term" value={`${loan.term_months} month(s)`} />
            <Row label="Repayment Frequency" value={FREQUENCY_LABELS[loan.repayment_frequency] || loan.repayment_frequency} />
            <Row label="Disbursement Date" value={loan.disbursement_date ? formatDate(loan.disbursement_date) : 'Not yet disbursed'} />
            <Row label="First Due Date" value={formatDate(firstDueDate)} />
            <Row label="Maturity Date" value={formatDate(maturityDate)} />
            <Row label="Total Interest" value={peso(totalInterest)} />
            <Row label="Total Amount Payable" value={peso(totalPayable)} bold />
          </tbody>
        </table>

        <h2 className="font-bold text-sm mt-5 mb-2 uppercase tracking-wide">3. Terms and Conditions</h2>
        <ol className="list-decimal ml-5 space-y-1.5">
          <li>The Borrower agrees to repay the Principal Amount plus interest according to the Repayment Schedule (Section 5).</li>
          <li>Payments shall be applied first to any accrued late-payment penalty, then to the oldest outstanding installment.</li>
          <li>
            Should any amount remain unpaid after the Maturity Date, a late-payment penalty of <strong>2% per month
            (0.067% per day)</strong> shall accrue on the outstanding balance until paid in full.
          </li>
          <li>The Borrower may settle any installment or the full outstanding balance ahead of schedule without penalty.</li>
          <li>This Agreement is governed by the mutual understanding of both parties and applicable laws of the Philippines.</li>
        </ol>

        <h2 className="font-bold text-sm mt-5 mb-2 uppercase tracking-wide">4. Acknowledgement</h2>
        <p className="mb-2">
          By signing below, the Borrower acknowledges having read, understood, and agreed to all terms and conditions
          of this Agreement, and confirms receipt of the Principal Amount stated above upon disbursement.
        </p>

        <h2 className="font-bold text-sm mt-5 mb-2 uppercase tracking-wide">5. Repayment Schedule</h2>
        {schedule.length === 0 ? (
          <p className="text-slatey mb-2">No schedule generated yet.</p>
        ) : (
          <table className="w-full border-collapse mb-2 text-xs">
            <thead>
              <tr className="border-b border-black/30">
                <th className="text-left py-1 pr-2 font-semibold">#</th>
                <th className="text-left py-1 pr-2 font-semibold">Due Date</th>
                <th className="text-right py-1 pr-2 font-semibold">Principal</th>
                <th className="text-right py-1 pr-2 font-semibold">Interest</th>
                <th className="text-right py-1 font-semibold">Total Due</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map(row => (
                <tr key={row.id} className="border-b border-black/10">
                  <td className="py-1 pr-2">{row.installment_number}</td>
                  <td className="py-1 pr-2">{formatDate(row.due_date)}</td>
                  <td className="py-1 pr-2 text-right">{peso(row.principal_due)}</td>
                  <td className="py-1 pr-2 text-right">{peso(row.interest_due)}</td>
                  <td className="py-1 text-right">{peso(row.total_due)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="py-1.5 pr-2 text-right font-semibold">Total</td>
                <td className="py-1.5 text-right font-semibold">{peso(totalPayable)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="grid grid-cols-2 gap-10 mt-14">
          <SignatureBlock label="Borrower" sublabel={isGroup ? (loan.borrower_groups?.group_name || '') : (borrower?.full_name || '')} />
          <SignatureBlock label="Lender / Authorized Representative" sublabel="JBSARIO Microfinance" />
        </div>

        <div className="grid grid-cols-2 gap-10 mt-14">
          <SignatureBlock label="Witness" />
          <SignatureBlock label="Witness" />
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <tr className="border-b border-black/10">
      <td className="py-1 pr-3 text-slatey w-[38%] align-top">{label}</td>
      <td className={`py-1 ${bold ? 'font-semibold' : ''}`}>{value || '—'}</td>
    </tr>
  )
}

function SignatureBlock({ label, sublabel }) {
  return (
    <div>
      <div className="border-b border-black h-10" />
      <p className="text-xs mt-1">{label}</p>
      {sublabel && <p className="text-xs text-slatey">{sublabel}</p>}
      <p className="text-xs text-slatey mt-3">Date: _________________</p>
    </div>
  )
}
