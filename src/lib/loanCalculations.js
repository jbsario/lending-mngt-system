// Generates a repayment schedule for a loan.
// Supports two common microfinance interest methods:
//  - 'flat': interest is calculated on the original principal for every installment
//  - 'declining': interest is calculated on the remaining balance each installment

const DAILY_PENALTY_RATE = 0.00067 // 0.067%/day ≈ 2%/month, per the loan agreement's late-payment clause

function addInterval(date, frequency, count) {
  const d = new Date(date)
  if (frequency === 'daily') d.setDate(d.getDate() + count)
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7 * count)
  else if (frequency === 'biweekly') d.setDate(d.getDate() + 14 * count)
  else d.setMonth(d.getMonth() + count) // monthly
  return d
}

// Next occurrence of `weekday` (0=Sunday..6=Saturday) strictly after `date` —
// used to pin weekly/biweekly schedules to a fixed collection day (e.g. every
// Saturday) instead of whatever weekday the disbursement date happens to fall on.
function nextWeekday(date, weekday) {
  const d = new Date(date)
  let diff = (weekday - d.getDay() + 7) % 7
  if (diff === 0) diff = 7
  d.setDate(d.getDate() + diff)
  return d
}

function dueDateFor(disbursementDate, frequency, installmentNumber, paymentWeekday) {
  if (paymentWeekday != null && paymentWeekday !== '' && (frequency === 'weekly' || frequency === 'biweekly')) {
    const interval = frequency === 'biweekly' ? 14 : 7
    const first = nextWeekday(disbursementDate, Number(paymentWeekday))
    first.setDate(first.getDate() + interval * (installmentNumber - 1))
    return first
  }
  return addInterval(disbursementDate, frequency, installmentNumber)
}

function installmentsFor(termMonths, frequency) {
  if (frequency === 'daily') return Math.round(termMonths * 30)
  if (frequency === 'weekly') return Math.round((termMonths * 30) / 7)
  if (frequency === 'biweekly') return Math.round((termMonths * 30) / 14)
  return termMonths
}

export function generateSchedule({
  principal,
  interestRate, // percentage, e.g. 3.5 means 3.5%
  interestMethod = 'flat',
  termMonths,
  frequency = 'monthly',
  disbursementDate,
  paymentWeekday // 0=Sunday..6=Saturday; only used for weekly/biweekly
}) {
  const numInstallments = installmentsFor(termMonths, frequency)
  const schedule = []

  if (interestMethod === 'flat') {
    // Flat rate applied once per term-month, spread evenly across installments
    const totalInterest = principal * (interestRate / 100) * termMonths
    const principalAmounts = splitEvenly(principal, numInstallments)
    const interestAmounts = splitEvenly(totalInterest, numInstallments)

    for (let i = 1; i <= numInstallments; i++) {
      const principalDue = principalAmounts[i - 1]
      const interestDue = interestAmounts[i - 1]
      schedule.push({
        installment_number: i,
        due_date: dueDateFor(disbursementDate, frequency, i, paymentWeekday).toISOString().slice(0, 10),
        principal_due: principalDue,
        interest_due: interestDue,
        total_due: roundPeso(principalDue + interestDue),
        amount_paid: 0,
        status: 'unpaid',
        frequency
      })
    }
  } else {
    // Declining balance: recompute interest on remaining principal each period
    let balance = principal
    const ratePerPeriod = (interestRate / 100) / periodsPerMonth(frequency)
    const principalAmounts = splitEvenly(principal, numInstallments)

    for (let i = 1; i <= numInstallments; i++) {
      const principalDue = principalAmounts[i - 1]
      const interestDue = roundPeso(balance * ratePerPeriod)
      schedule.push({
        installment_number: i,
        due_date: dueDateFor(disbursementDate, frequency, i, paymentWeekday).toISOString().slice(0, 10),
        principal_due: principalDue,
        interest_due: interestDue,
        total_due: roundPeso(principalDue + interestDue),
        amount_paid: 0,
        status: 'unpaid',
        frequency
      })
      balance -= principalDue
    }
  }

  return schedule
}

function periodsPerMonth(frequency) {
  if (frequency === 'daily') return 30
  if (frequency === 'weekly') return 4
  if (frequency === 'biweekly') return 2
  return 1
}

// Peso amounts here are whole pesos, no centavos — this is cash-based
// informal lending, not electronic transfers with fractional currency.
function roundPeso(n) {
  return Math.round(n)
}

// Splits `total` into `count` amounts that are as equal as possible and,
// unlike naively rounding total/count for every slot, sum to EXACTLY
// `total` — any rounding remainder is folded into the last installment
// instead of silently drifting the grand total by a few pesos.
function splitEvenly(total, count) {
  const base = roundPeso(total / count)
  const amounts = new Array(count).fill(base)
  const diff = roundPeso(total - roundPeso(base * count))
  amounts[count - 1] = roundPeso(amounts[count - 1] + diff)
  return amounts
}

// Total interest and total payable (principal + interest) for a loan record,
// using the same math as generateSchedule but without building the rows.
export function computeLoanTotals(loan) {
  const principal = Number(loan.principal_amount)
  const rate = Number(loan.interest_rate)
  const termMonths = Number(loan.term_months)
  const frequency = loan.repayment_frequency || 'monthly'

  let totalInterest
  if (loan.interest_method === 'declining') {
    const numInstallments = installmentsFor(termMonths, frequency)
    const ratePerPeriod = (rate / 100) / periodsPerMonth(frequency)
    const principalPerInstallment = principal / numInstallments
    let balance = principal
    totalInterest = 0
    for (let i = 1; i <= numInstallments; i++) {
      totalInterest += balance * ratePerPeriod
      balance -= principalPerInstallment
    }
  } else {
    totalInterest = principal * (rate / 100) * termMonths
  }

  return {
    totalInterest: roundPeso(totalInterest),
    totalPayable: roundPeso(principal + totalInterest)
  }
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000)
}

// The loan's Maturity Date is the due date of its final installment.
export function computeMaturityDate(schedule) {
  if (!schedule || schedule.length === 0) return null
  return schedule.reduce((latest, r) => (r.due_date > latest ? r.due_date : latest), schedule[0].due_date)
}

// Per the late-payment clause: once the Maturity Date passes with an unpaid
// balance, that balance accrues a 2%/month (0.067%/day) penalty until paid
// in full. Recomputed fresh each time from the *current* outstanding balance
// rather than accrued day-by-day, since balance only changes when a payment
// posts — there's nothing to accrue against in between.
export function computeLoanPenalty(schedule, penaltyPaid = 0, asOfDate = new Date()) {
  const maturityDate = computeMaturityDate(schedule)
  const outstandingBalance = roundPeso(
    schedule.reduce((s, r) => s + (Number(r.total_due) - Number(r.amount_paid)), 0)
  )

  if (!maturityDate || outstandingBalance <= 0) {
    return { maturityDate, daysLate: 0, outstandingBalance: 0, accruedPenalty: 0, penaltyOwed: 0 }
  }

  const daysLate = Math.max(0, daysBetween(maturityDate, asOfDate))
  const accruedPenalty = daysLate > 0 ? roundPeso(outstandingBalance * DAILY_PENALTY_RATE * daysLate) : 0
  const penaltyOwed = Math.max(0, roundPeso(accruedPenalty - Number(penaltyPaid)))

  return { maturityDate, daysLate, outstandingBalance, accruedPenalty, penaltyOwed }
}

export function summarizeLoan(schedule, asOfDate = new Date()) {
  const totalDue = schedule.reduce((s, r) => s + Number(r.total_due), 0)
  const totalPaid = schedule.reduce((s, r) => s + Number(r.amount_paid), 0)
  const overdueCount = schedule.filter(r => r.status !== 'paid' && daysBetween(r.due_date, asOfDate) > 0).length
  return {
    totalDue: roundPeso(totalDue),
    totalPaid: roundPeso(totalPaid),
    balance: roundPeso(totalDue - totalPaid),
    overdueCount
  }
}
