import { supabase } from './supabaseClient'
import { computeLoanPenalty } from './loanCalculations'

function check(error) {
  if (error) throw new Error(error.message)
}

// ---------- Activity log ----------
// Every mutating call below writes an entry here. Failures are swallowed so a
// logging hiccup never blocks the actual operation.
export async function logActivity(action, entity, recordId, summary, details = null) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('lend_activity_logs').insert({
      user_id: user?.id || null,
      user_email: user?.email || '',
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
  const { data, error } = await supabase
    .from('lend_activity_logs')
    .select('*')
    .order('created', { ascending: false })
    .limit(limit)
  check(error)
  return data
}

// ---------- Borrowers ----------
export async function listBorrowers() {
  const { data, error } = await supabase.from('lend_borrowers').select('*').order('created', { ascending: false })
  check(error)
  return data
}

export async function createBorrower(borrower) {
  const { data, error } = await supabase.from('lend_borrowers').insert(borrower).select().single()
  check(error)
  await logActivity('create', 'borrowers', data.id, `Added borrower "${data.full_name}"`)
  return data
}

export async function updateBorrower(id, updates) {
  const { data, error } = await supabase
    .from('lend_borrowers')
    .update({ ...updates, updated: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  check(error)
  await logActivity('update', 'borrowers', id, `Updated borrower "${data.full_name}"`, { changed: Object.keys(updates) })
  return data
}

export async function deleteBorrower(id) {
  const { data: borrower } = await supabase.from('lend_borrowers').select('full_name').eq('id', id).single()
  const { error } = await supabase.from('lend_borrowers').delete().eq('id', id)
  check(error)
  await logActivity('delete', 'borrowers', id, `Deleted borrower "${borrower?.full_name || ''}"`)
}

// ---------- Groups ----------
export async function listGroups() {
  const { data: groups, error } = await supabase.from('lend_borrower_groups').select('*').order('created', { ascending: false })
  check(error)

  const { data: members, error: membersError } = await supabase
    .from('lend_group_members')
    .select('*, borrowers:lend_borrowers(full_name)')
  check(membersError)

  return groups.map(g => ({
    ...g,
    group_members: members
      .filter(m => m.group_id === g.id)
      .map(m => ({ id: m.id, borrower_id: m.borrower_id, borrowers: { full_name: m.borrowers?.full_name || '—' } }))
  }))
}

export async function createGroup(group) {
  const { data, error } = await supabase
    .from('lend_borrower_groups')
    .insert({ group_name: group.group_name, meeting_schedule: group.meeting_schedule })
    .select()
    .single()
  check(error)
  await logActivity('create', 'borrower_groups', data.id, `Added group "${data.group_name}"`)
  return data
}

export async function addGroupMember(groupId, borrowerId) {
  const { data, error } = await supabase
    .from('lend_group_members')
    .insert({ group_id: groupId, borrower_id: borrowerId })
    .select()
    .single()
  check(error)
  await logActivity('create', 'group_members', data.id, 'Added a borrower to a group', { group: groupId, borrower: borrowerId })
  return data
}

export async function removeGroupMember(memberRowId) {
  const { error } = await supabase.from('lend_group_members').delete().eq('id', memberRowId)
  check(error)
  await logActivity('delete', 'group_members', memberRowId, 'Removed a borrower from a group')
}

// ---------- Loans ----------
const LOAN_SELECT = '*, borrowers:lend_borrowers(full_name), borrower_groups:lend_borrower_groups(group_name)'

function shapeLoan(l) {
  return {
    ...l,
    borrower_id: l.borrower_id || null,
    group_id: l.group_id || null,
    borrowers: l.borrowers || null,
    borrower_groups: l.borrower_groups || null
  }
}

// updateLoan() receives PocketBase-era relation field names ("borrower"/
// "group") from the Loans page form — normalize to the Postgres column names.
function normalizeLoanUpdates(updates) {
  const payload = { ...updates }
  if ('borrower' in payload) { payload.borrower_id = payload.borrower; delete payload.borrower }
  if ('group' in payload) { payload.group_id = payload.group; delete payload.group }
  return payload
}

export async function listLoans({ includeDeleted = false } = {}) {
  let query = supabase.from('lend_loans').select(LOAN_SELECT).order('created', { ascending: false })
  if (!includeDeleted) query = query.eq('deleted', false)
  const { data, error } = await query
  check(error)
  return data.map(shapeLoan)
}

export async function getLoan(id) {
  const { data, error } = await supabase.from('lend_loans').select(LOAN_SELECT).eq('id', id).single()
  check(error)
  return shapeLoan(data)
}

export async function createLoan(loan) {
  const payload = {
    loan_number: loan.loan_number,
    borrower_id: loan.borrower_id || null,
    group_id: loan.group_id || null,
    principal_amount: loan.principal_amount,
    interest_rate: loan.interest_rate,
    interest_method: loan.interest_method,
    term_months: loan.term_months,
    repayment_frequency: loan.repayment_frequency,
    disbursement_date: loan.disbursement_date || null,
    purpose: loan.purpose,
    status: loan.status
  }
  const { data, error } = await supabase.from('lend_loans').insert(payload).select(LOAN_SELECT).single()
  check(error)
  await logActivity('create', 'loans', data.id,
    `Created loan ${data.loan_number} — principal ₱${Number(data.principal_amount).toLocaleString()}`)
  return shapeLoan(data)
}

export async function updateLoan(id, updates) {
  const payload = { ...normalizeLoanUpdates(updates), updated: new Date().toISOString() }
  const { data, error } = await supabase.from('lend_loans').update(payload).eq('id', id).select(LOAN_SELECT).single()
  check(error)
  await logActivity('update', 'loans', id, `Edited loan ${data.loan_number}`, { changed: Object.keys(updates) })
  return shapeLoan(data)
}

export async function updateLoanStatus(id, status) {
  const { data, error } = await supabase.from('lend_loans').update({ status }).eq('id', id).select(LOAN_SELECT).single()
  check(error)
  await logActivity('update', 'loans', id, `Loan ${data.loan_number} status changed to "${status}"`)
  return shapeLoan(data)
}

export async function softDeleteLoan(loan) {
  const { data, error } = await supabase.from('lend_loans').update({ deleted: true }).eq('id', loan.id).select(LOAN_SELECT).single()
  check(error)
  await logActivity('delete', 'loans', loan.id, `Deleted loan ${loan.loan_number} (recoverable)`)
  return shapeLoan(data)
}

export async function restoreLoan(loan) {
  const { data, error } = await supabase.from('lend_loans').update({ deleted: false }).eq('id', loan.id).select(LOAN_SELECT).single()
  check(error)
  await logActivity('restore', 'loans', loan.id, `Restored loan ${loan.loan_number}`)
  return shapeLoan(data)
}

// ---------- Repayment schedule ----------
export async function insertSchedule(loanId, rows) {
  const { data, error } = await supabase
    .from('lend_repayment_schedule')
    .insert(rows.map(r => ({ ...r, loan_id: loanId })))
    .select()
  check(error)
  return data
}

export async function deleteScheduleForLoan(loanId) {
  const { error } = await supabase.from('lend_repayment_schedule').delete().eq('loan_id', loanId)
  check(error)
}

export async function listScheduleForLoan(loanId) {
  const { data, error } = await supabase
    .from('lend_repayment_schedule')
    .select('*')
    .eq('loan_id', loanId)
    .order('installment_number', { ascending: true })
  check(error)
  return data
}

export async function updateScheduleRow(id, updates) {
  const { data, error } = await supabase
    .from('lend_repayment_schedule')
    .update({ ...updates, updated: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  check(error)
  return data
}

// ---------- Payments ----------
function round2(n) {
  return Math.round(n * 100) / 100
}

export async function recordPayment(payment) {
  const { data, error } = await supabase
    .from('lend_payments')
    .insert({
      loan_id: payment.loan_id,
      schedule_id: payment.schedule_id || null,
      amount: payment.amount,
      payment_date: payment.payment_date,
      payment_method: payment.payment_method,
      received_by: payment.received_by || '',
      notes: payment.notes || ''
    })
    .select()
    .single()
  check(error)
  await logActivity('payment', 'payments', data.id,
    `Payment of ₱${Number(payment.amount).toLocaleString()}${payment.loan_number ? ` on loan ${payment.loan_number}` : ''}`)
  return data
}

// Records one payment against a loan. Per the loan agreement's late-payment
// clause, the amount is applied in this order: (1) any accrued late-payment
// penalty, (2) the earliest open installments oldest-first (each
// installment's total_due already bundles its own interest + principal).
// Marks the loan completed when the last installment is settled.
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

  const penalty = computeLoanPenalty(schedule, loan.penalty_paid || 0, payment_date)
  let penaltyApplied = 0
  if (penalty.penaltyOwed > 0) {
    penaltyApplied = round2(Math.min(penalty.penaltyOwed, remaining))
    if (penaltyApplied > 0) {
      await supabase
        .from('lend_loans')
        .update({ penalty_paid: round2(Number(loan.penalty_paid || 0) + penaltyApplied) })
        .eq('id', loan.id)
      remaining = round2(remaining - penaltyApplied)
    }
  }

  const allocations = []
  for (const row of open) {
    if (remaining <= 0) break
    const owed = round2(Number(row.total_due) - Number(row.amount_paid))
    const applied = Math.min(owed, remaining)
    const newPaid = round2(Number(row.amount_paid) + applied)
    const newStatus = newPaid >= Number(row.total_due) ? 'paid' : 'partial'
    await updateScheduleRow(row.id, { amount_paid: newPaid, status: newStatus })
    allocations.push({ installment: row.installment_number, applied })
    remaining = round2(remaining - applied)
  }

  const { data: created, error } = await supabase
    .from('lend_payments')
    .insert({
      loan_id: loan.id,
      schedule_id: allocations.length === 1 ? open[0].id : null,
      amount,
      payment_date,
      payment_method,
      received_by: received_by || '',
      notes: notes || ''
    })
    .select()
    .single()
  check(error)

  const after = await listScheduleForLoan(loan.id)
  const loanCompleted = after.every(r => r.status === 'paid') && penalty.penaltyOwed - penaltyApplied <= 0
  if (loanCompleted && loan.status !== 'completed') {
    await supabase.from('lend_loans').update({ status: 'completed' }).eq('id', loan.id)
  }

  await logActivity('payment', 'payments', created.id,
    `Payment of ₱${Number(amount).toLocaleString()} on loan ${loan.loan_number}` +
    (penaltyApplied > 0 ? ` (₱${penaltyApplied.toLocaleString()} applied to late penalty first)` : '') +
    (loanCompleted ? ' — loan fully paid' : ''),
    { penaltyApplied, allocations, unallocated: remaining })

  return { payment: created, penaltyApplied, allocations, unallocated: remaining, loanCompleted }
}

export async function listPaymentsForLoan(loanId) {
  const { data, error } = await supabase
    .from('lend_payments')
    .select('*')
    .eq('loan_id', loanId)
    .order('payment_date', { ascending: false })
  check(error)
  return data
}

export async function listRecentPayments(limit = 20) {
  const { data, error } = await supabase
    .from('lend_payments')
    .select('*, loans:lend_loans(loan_number, deleted, borrowers:lend_borrowers(full_name))')
    .order('payment_date', { ascending: false })
    .limit(limit)
  check(error)
  return data
    .filter(p => !p.loans || p.loans.deleted !== true)
    .map(p => ({ ...p, loan_id: p.loan_id }))
}

// ---------- Documents ----------
const DOCUMENTS_BUCKET = 'lend-documents'

export async function uploadDocument({ file, borrowerId, loanId, docType }) {
  const path = `${crypto.randomUUID()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file)
  check(uploadError)

  const { data, error } = await supabase
    .from('lend_documents')
    .insert({
      file_path: path,
      file_name: file.name,
      doc_type: docType,
      borrower_id: borrowerId || null,
      loan_id: loanId || null
    })
    .select()
    .single()
  check(error)
  await logActivity('create', 'documents', data.id, `Uploaded document "${file.name}" (${docType})`)
  return data
}

export async function listDocuments({ borrowerId, loanId } = {}) {
  let query = supabase
    .from('lend_documents')
    .select('*, borrowers:lend_borrowers(full_name)')
    .order('created', { ascending: false })
  if (borrowerId) query = query.eq('borrower_id', borrowerId)
  if (loanId) query = query.eq('loan_id', loanId)
  const { data, error } = await query
  check(error)
  return data.map(d => ({ ...d, uploaded_at: d.created }))
}

// Returns a viewable URL for a document record — a short-lived signed URL
// against the private lend-documents storage bucket.
export async function getDocumentUrl(doc) {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(doc.file_path, 60)
  check(error)
  return data.signedUrl
}

export async function deleteDocument(doc) {
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.file_path])
  const { error } = await supabase.from('lend_documents').delete().eq('id', doc.id)
  check(error)
  await logActivity('delete', 'documents', doc.id, `Deleted document "${doc.file_name || doc.file_path}"`)
}

// ---------- Dashboard ----------
export async function getDashboardStats() {
  const [
    { data: borrowers, error: bErr },
    { data: loans, error: lErr },
    { data: schedule, error: sErr },
    { data: payments, error: pErr }
  ] = await Promise.all([
    supabase.from('lend_borrowers').select('id'),
    supabase.from('lend_loans').select('*').eq('deleted', false),
    supabase.from('lend_repayment_schedule').select('*, lend_loans(deleted)'),
    supabase.from('lend_payments').select('amount, lend_loans(deleted)')
  ])
  check(bErr); check(lErr); check(sErr); check(pErr)

  const activeSchedule = schedule.filter(r => !r.lend_loans || r.lend_loans.deleted !== true)
  const activePayments = payments.filter(p => !p.lend_loans || p.lend_loans.deleted !== true)
  const activeLoans = loans.filter(l => l.status === 'active')
  const totalDisbursed = loans.reduce((s, l) => s + Number(l.principal_amount), 0)
  const totalOutstanding = activeSchedule.reduce((s, r) => s + (Number(r.total_due) - Number(r.amount_paid)), 0)
  const overdueCount = activeSchedule.filter(r => r.status !== 'paid' && new Date(r.due_date) < new Date()).length
  const totalPayments = activePayments.reduce((s, p) => s + Number(p.amount), 0)
  // Forecast: total interest expected across every non-deleted loan's full
  // schedule, whether or not it has been collected yet.
  const projectedInterestIncome = activeSchedule.reduce((s, r) => s + Number(r.interest_due), 0)

  return {
    borrowerCount: borrowers.length,
    activeLoanCount: activeLoans.length,
    totalDisbursed,
    totalOutstanding: Math.max(totalOutstanding, 0),
    overdueCount,
    totalPayments,
    projectedInterestIncome
  }
}
