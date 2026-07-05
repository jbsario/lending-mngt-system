import { pb } from './pocketbaseClient'

// ---------- Activity log ----------
// Every mutating call below writes an entry here. Failures are swallowed so a
// logging hiccup never blocks the actual operation.
export async function logActivity(action, entity, recordId, summary, details = null) {
  try {
    await pb.collection('activity_logs').create({
      user: pb.authStore.model?.id || null,
      user_email: pb.authStore.model?.email || '',
      action,
      entity,
      record_id: recordId || '',
      summary,
      details
    })
  } catch (err) {
    console.warn('Failed to write activity log:', err)
  }
}

export async function listActivityLogs(limit = 300) {
  const result = await pb.collection('activity_logs').getList(1, limit, { sort: '-created' })
  return result.items
}

// ---------- Borrowers ----------
export async function listBorrowers() {
  return pb.collection('borrowers').getFullList({ sort: '-created' })
}

export async function createBorrower(borrower) {
  const created = await pb.collection('borrowers').create(borrower)
  await logActivity('create', 'borrowers', created.id, `Added borrower "${created.full_name}"`)
  return created
}

export async function updateBorrower(id, updates) {
  const updated = await pb.collection('borrowers').update(id, updates)
  await logActivity('update', 'borrowers', id, `Updated borrower "${updated.full_name}"`, { changed: Object.keys(updates) })
  return updated
}

export async function deleteBorrower(id) {
  const borrower = await pb.collection('borrowers').getOne(id)
  await pb.collection('borrowers').delete(id)
  await logActivity('delete', 'borrowers', id, `Deleted borrower "${borrower.full_name}"`)
}

// ---------- Groups ----------
export async function listGroups() {
  const groups = await pb.collection('borrower_groups').getFullList({ sort: '-created' })
  const members = await pb.collection('group_members').getFullList({ expand: 'borrower' })

  return groups.map(g => ({
    ...g,
    group_members: members
      .filter(m => m.group === g.id)
      .map(m => ({ id: m.id, borrower_id: m.borrower, borrowers: { full_name: m.expand?.borrower?.full_name || '—' } }))
  }))
}

export async function createGroup(group) {
  const created = await pb.collection('borrower_groups').create({
    group_name: group.group_name,
    meeting_schedule: group.meeting_schedule
  })
  await logActivity('create', 'borrower_groups', created.id, `Added group "${created.group_name}"`)
  return created
}

export async function addGroupMember(groupId, borrowerId) {
  const created = await pb.collection('group_members').create({ group: groupId, borrower: borrowerId })
  await logActivity('create', 'group_members', created.id, 'Added a borrower to a group', { group: groupId, borrower: borrowerId })
  return created
}

export async function removeGroupMember(memberRowId) {
  await pb.collection('group_members').delete(memberRowId)
  await logActivity('delete', 'group_members', memberRowId, 'Removed a borrower from a group')
}

// ---------- Loans ----------
function shapeLoan(l) {
  return {
    ...l,
    borrower_id: l.borrower || null,
    group_id: l.group || null,
    borrowers: l.expand?.borrower ? { full_name: l.expand.borrower.full_name } : null,
    borrower_groups: l.expand?.group ? { group_name: l.expand.group.group_name } : null
  }
}

export async function listLoans({ includeDeleted = false } = {}) {
  const loans = await pb.collection('loans').getFullList({
    sort: '-created',
    expand: 'borrower,group',
    filter: includeDeleted ? '' : 'deleted != true'
  })
  return loans.map(shapeLoan)
}

export async function getLoan(id) {
  const loan = await pb.collection('loans').getOne(id, { expand: 'borrower,group' })
  return shapeLoan(loan)
}

export async function createLoan(loan) {
  const payload = {
    loan_number: loan.loan_number,
    borrower: loan.borrower_id || null,
    group: loan.group_id || null,
    principal_amount: loan.principal_amount,
    interest_rate: loan.interest_rate,
    interest_method: loan.interest_method,
    term_months: loan.term_months,
    repayment_frequency: loan.repayment_frequency,
    disbursement_date: loan.disbursement_date || null,
    purpose: loan.purpose,
    status: loan.status
  }
  const created = await pb.collection('loans').create(payload)
  await logActivity('create', 'loans', created.id,
    `Created loan ${created.loan_number} — principal ₱${Number(created.principal_amount).toLocaleString()}`)
  return shapeLoan(created)
}

export async function updateLoan(id, updates) {
  const updated = await pb.collection('loans').update(id, updates, { expand: 'borrower,group' })
  await logActivity('update', 'loans', id, `Edited loan ${updated.loan_number}`, { changed: Object.keys(updates) })
  return shapeLoan(updated)
}

export async function updateLoanStatus(id, status) {
  const updated = await pb.collection('loans').update(id, { status })
  await logActivity('update', 'loans', id, `Loan ${updated.loan_number} status changed to "${status}"`)
  return shapeLoan(updated)
}

export async function softDeleteLoan(loan) {
  const updated = await pb.collection('loans').update(loan.id, { deleted: true })
  await logActivity('delete', 'loans', loan.id, `Deleted loan ${loan.loan_number} (recoverable)`)
  return shapeLoan(updated)
}

export async function restoreLoan(loan) {
  const updated = await pb.collection('loans').update(loan.id, { deleted: false })
  await logActivity('restore', 'loans', loan.id, `Restored loan ${loan.loan_number}`)
  return shapeLoan(updated)
}

// ---------- Repayment schedule ----------
export async function insertSchedule(loanId, rows) {
  return Promise.all(
    rows.map(r => pb.collection('repayment_schedule').create({ ...r, loan: loanId }))
  )
}

export async function deleteScheduleForLoan(loanId) {
  const rows = await pb.collection('repayment_schedule').getFullList({ filter: `loan = "${loanId}"` })
  await Promise.all(rows.map(r => pb.collection('repayment_schedule').delete(r.id)))
}

export async function listScheduleForLoan(loanId) {
  return pb.collection('repayment_schedule').getFullList({
    filter: `loan = "${loanId}"`,
    sort: 'installment_number'
  })
}

export async function updateScheduleRow(id, updates) {
  return pb.collection('repayment_schedule').update(id, updates)
}

// ---------- Payments ----------
function round2(n) {
  return Math.round(n * 100) / 100
}

export async function recordPayment(payment) {
  const created = await pb.collection('payments').create({
    loan: payment.loan_id,
    schedule: payment.schedule_id || null,
    amount: payment.amount,
    payment_date: payment.payment_date,
    payment_method: payment.payment_method,
    received_by: payment.received_by || '',
    notes: payment.notes || ''
  })
  await logActivity('payment', 'payments', created.id,
    `Payment of ₱${Number(payment.amount).toLocaleString()}${payment.loan_number ? ` on loan ${payment.loan_number}` : ''}`)
  return created
}

// Records one payment against a loan and spreads it across the earliest
// open installments (oldest first). Marks the loan completed when the last
// installment is settled.
export async function recordLoanPayment({ loan, amount, payment_date, payment_method, received_by, notes }) {
  const schedule = await listScheduleForLoan(loan.id)
  if (schedule.length === 0) {
    throw new Error('This loan has no repayment schedule yet (still pending disbursement).')
  }
  const open = schedule.filter(r => Number(r.amount_paid) < Number(r.total_due))
  if (open.length === 0) {
    throw new Error('This loan is already fully paid.')
  }

  let remaining = round2(amount)
  const allocations = []
  for (const row of open) {
    if (remaining <= 0) break
    const owed = round2(Number(row.total_due) - Number(row.amount_paid))
    const applied = Math.min(owed, remaining)
    const newPaid = round2(Number(row.amount_paid) + applied)
    const newStatus = newPaid >= Number(row.total_due) ? 'paid' : 'partial'
    await pb.collection('repayment_schedule').update(row.id, { amount_paid: newPaid, status: newStatus })
    allocations.push({ installment: row.installment_number, applied })
    remaining = round2(remaining - applied)
  }

  const created = await pb.collection('payments').create({
    loan: loan.id,
    schedule: allocations.length === 1 ? open[0].id : null,
    amount,
    payment_date,
    payment_method,
    received_by: received_by || '',
    notes: notes || ''
  })

  const after = await listScheduleForLoan(loan.id)
  const loanCompleted = after.every(r => r.status === 'paid')
  if (loanCompleted && loan.status !== 'completed') {
    await pb.collection('loans').update(loan.id, { status: 'completed' })
  }

  await logActivity('payment', 'payments', created.id,
    `Payment of ₱${Number(amount).toLocaleString()} on loan ${loan.loan_number}` +
    (loanCompleted ? ' — loan fully paid' : ''),
    { allocations, unallocated: remaining })

  return { payment: created, allocations, unallocated: remaining, loanCompleted }
}

export async function listPaymentsForLoan(loanId) {
  return pb.collection('payments').getFullList({
    filter: `loan = "${loanId}"`,
    sort: '-payment_date'
  })
}

function shapePayment(p) {
  return {
    ...p,
    loan_id: p.loan,
    loans: p.expand?.loan
      ? {
          loan_number: p.expand.loan.loan_number,
          borrowers: p.expand.loan.expand?.borrower ? { full_name: p.expand.loan.expand.borrower.full_name } : null
        }
      : null
  }
}

export async function listRecentPayments(limit = 20) {
  const payments = await pb.collection('payments').getList(1, limit, {
    sort: '-payment_date',
    expand: 'loan,loan.borrower',
    filter: 'loan.deleted != true'
  })
  return payments.items.map(shapePayment)
}

// ---------- Documents ----------
export async function uploadDocument({ file, borrowerId, loanId, docType }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('doc_type', docType)
  formData.append('file_name', file.name)
  if (borrowerId) formData.append('borrower', borrowerId)
  if (loanId) formData.append('loan', loanId)
  const created = await pb.collection('documents').create(formData)
  await logActivity('create', 'documents', created.id, `Uploaded document "${file.name}" (${docType})`)
  return created
}

function shapeDocument(d) {
  return {
    ...d,
    file_name: d.file_name || d.file,
    uploaded_at: d.created,
    borrowers: d.expand?.borrower ? { full_name: d.expand.borrower.full_name } : null
  }
}

export async function listDocuments({ borrowerId, loanId } = {}) {
  const filters = []
  if (borrowerId) filters.push(`borrower = "${borrowerId}"`)
  if (loanId) filters.push(`loan = "${loanId}"`)
  const docs = await pb.collection('documents').getFullList({
    sort: '-created',
    expand: 'borrower',
    filter: filters.join(' && ') || ''
  })
  return docs.map(shapeDocument)
}

// Returns a viewable URL for a document record. PocketBase serves files
// under a private collection using a short-lived auth token appended to the URL.
export async function getDocumentUrl(doc) {
  const token = await pb.files.getToken()
  return pb.files.getUrl(doc, doc.file, { token })
}

export async function deleteDocument(doc) {
  await pb.collection('documents').delete(doc.id)
  await logActivity('delete', 'documents', doc.id, `Deleted document "${doc.file_name || doc.file}"`)
}

// ---------- Dashboard ----------
export async function getDashboardStats() {
  const [borrowers, loans, schedule] = await Promise.all([
    pb.collection('borrowers').getFullList(),
    pb.collection('loans').getFullList({ filter: 'deleted != true' }),
    pb.collection('repayment_schedule').getFullList({ filter: 'loan.deleted != true' })
  ])

  const activeLoans = loans.filter(l => l.status === 'active')
  const totalDisbursed = loans.reduce((s, l) => s + Number(l.principal_amount), 0)
  const totalOutstanding = schedule.reduce((s, r) => s + (Number(r.total_due) - Number(r.amount_paid)), 0)
  const overdueCount = schedule.filter(r => r.status === 'overdue').length

  return {
    borrowerCount: borrowers.length,
    activeLoanCount: activeLoans.length,
    totalDisbursed,
    totalOutstanding: Math.max(totalOutstanding, 0),
    overdueCount
  }
}
