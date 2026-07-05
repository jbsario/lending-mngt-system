// Generates a repayment schedule for a loan.
// Supports two common microfinance interest methods:
//  - 'flat': interest is calculated on the original principal for every installment
//  - 'declining': interest is calculated on the remaining balance each installment

function addInterval(date, frequency, count) {
  const d = new Date(date)
  if (frequency === 'weekly') d.setDate(d.getDate() + 7 * count)
  else if (frequency === 'biweekly') d.setDate(d.getDate() + 14 * count)
  else d.setMonth(d.getMonth() + count) // monthly
  return d
}

function installmentsFor(termMonths, frequency) {
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
  disbursementDate
}) {
  const numInstallments = installmentsFor(termMonths, frequency)
  const schedule = []

  if (interestMethod === 'flat') {
    // Flat rate applied once per term-month, spread evenly across installments
    const totalInterest = principal * (interestRate / 100) * termMonths
    const totalPayable = principal + totalInterest
    const perInstallment = totalPayable / numInstallments
    const principalPerInstallment = principal / numInstallments
    const interestPerInstallment = totalInterest / numInstallments

    for (let i = 1; i <= numInstallments; i++) {
      schedule.push({
        installment_number: i,
        due_date: addInterval(disbursementDate, frequency, i).toISOString().slice(0, 10),
        principal_due: round2(principalPerInstallment),
        interest_due: round2(interestPerInstallment),
        total_due: round2(perInstallment),
        amount_paid: 0,
        status: 'unpaid'
      })
    }
  } else {
    // Declining balance: recompute interest on remaining principal each period
    let balance = principal
    const ratePerPeriod = (interestRate / 100) / periodsPerMonth(frequency)
    const principalPerInstallment = principal / numInstallments

    for (let i = 1; i <= numInstallments; i++) {
      const interestDue = balance * ratePerPeriod
      const totalDue = principalPerInstallment + interestDue
      schedule.push({
        installment_number: i,
        due_date: addInterval(disbursementDate, frequency, i).toISOString().slice(0, 10),
        principal_due: round2(principalPerInstallment),
        interest_due: round2(interestDue),
        total_due: round2(totalDue),
        amount_paid: 0,
        status: 'unpaid'
      })
      balance -= principalPerInstallment
    }
  }

  return schedule
}

function periodsPerMonth(frequency) {
  if (frequency === 'weekly') return 4
  if (frequency === 'biweekly') return 2
  return 1
}

function round2(n) {
  return Math.round(n * 100) / 100
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
    totalInterest: round2(totalInterest),
    totalPayable: round2(principal + totalInterest)
  }
}

export function summarizeLoan(schedule) {
  const totalDue = schedule.reduce((s, r) => s + Number(r.total_due), 0)
  const totalPaid = schedule.reduce((s, r) => s + Number(r.amount_paid), 0)
  const overdueCount = schedule.filter(r => r.status === 'overdue').length
  return {
    totalDue: round2(totalDue),
    totalPaid: round2(totalPaid),
    balance: round2(totalDue - totalPaid),
    overdueCount
  }
}
