// Supabase Edge Function: send-sms
//
// React frontend never talks to the SMS gateway or holds its credentials.
// The frontend sends { loan_id, sms_type } for a loan-specific SMS, or
// { borrower_id, sms_type: 'loan_balance_summary' } for the borrower-level
// "all active loans" overall summary — never both. This function looks up
// the loan/borrower/loans itself, generates the message from a fixed
// template, and is the only place gateway credentials (Supabase secrets)
// are ever read.
//
// Multi-loan note: a borrower can have several loans. Every loan-specific
// template (payment_reminder, overdue_notice, etc.) is built from exactly
// one loan_id's own schedule/payments — never another loan's data, and
// never combined across loans. The only place loans are combined is the
// borrower-scoped loan_balance_summary path, which explicitly fetches every
// active/defaulted loan for that borrower and sums them without any
// loan-x-payments join (each aggregate is a single batched query grouped in
// JS), so amounts are never double-counted.
//
// Architecture: React → (this function) → SMS Gateway for Android → phone → borrower.
//
// Deliberately self-contained (no imports from sibling files): the Supabase
// Dashboard's function editor doesn't reliably bundle relative-path imports
// pasted in as separate files, so everything lives in this one file. If you
// deploy via the Supabase CLI instead, this still works unchanged.

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const DUPLICATE_WINDOW_MS = 30_000
// For a reminder/overdue-notice tied to a specific installment: block a
// resend of the SAME (loan, sms_type, installment) within this window, not
// forever — lets a daily automation run skip re-notifying the same event
// every day, while still letting staff manually re-send after a day if
// they choose to. payment_received uses no window at all (see below) since
// a given payment should only ever be announced once, period.
const EVENT_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000
const GATEWAY_TIMEOUT_MS = 15000
const DEFAULT_GATEWAY_BASE_URL = 'https://api.sms-gate.app'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  })
}

// ---------- Philippine phone number normalization ----------
// Accepts: 09171234567, +639171234567, 639171234567 → all become +639171234567.
// Already-"+"-prefixed non-PH numbers pass through unchanged rather than
// being rejected or mangled, so this doesn't break if the app ever supports
// other countries' borrowers.
function normalizePhilippineNumber(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'No phone number on file for this borrower.' }
  }

  const digitsOnly = raw.trim().replace(/[\s-]/g, '')

  if (digitsOnly.startsWith('+')) {
    if (/^\+\d{8,15}$/.test(digitsOnly)) {
      return { ok: true, normalized: digitsOnly }
    }
    return { ok: false, error: `Phone number "${raw}" doesn't look like a valid international number.` }
  }

  if (/^09\d{9}$/.test(digitsOnly)) {
    return { ok: true, normalized: `+63${digitsOnly.slice(1)}` }
  }

  if (/^639\d{9}$/.test(digitsOnly)) {
    return { ok: true, normalized: `+${digitsOnly}` }
  }

  return { ok: false, error: `Phone number "${raw}" isn't a recognized Philippine mobile format.` }
}

// ---------- Loan math (ported from src/lib/loanCalculations.js) ----------
// Duplicated rather than imported — this Edge Function is a separate Deno
// runtime from the Vite/React app, and the file is deliberately
// self-contained (see header). Keep in sync with loanCalculations.js by
// hand if the interest math ever changes.

function roundPeso(n) {
  return Math.round(n)
}

function installmentsFor(termMonths, frequency) {
  if (frequency === 'daily') return Math.round(termMonths * 30)
  if (frequency === 'weekly') return Math.round((termMonths * 30) / 7)
  if (frequency === 'biweekly') return Math.round((termMonths * 30) / 14)
  return termMonths
}

function periodsPerMonth(frequency) {
  if (frequency === 'daily') return 30
  if (frequency === 'weekly') return 4
  if (frequency === 'biweekly') return 2
  return 1
}

// Total payable (principal + interest) for a loan — same math as
// computeLoanTotals in loanCalculations.js, without building schedule rows.
function computeLoanTotals(loan) {
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

  return { totalInterest: roundPeso(totalInterest), totalPayable: roundPeso(principal + totalInterest) }
}

// ---------- Centralized SMS templates ----------
// Each is a pure function of loan/borrower/schedule/payments data already
// fetched below for THAT ONE loan; none accept free text from the caller,
// and none ever see another loan's data.

function formatPeso(amount) {
  return `₱${Math.round(Number(amount)).toLocaleString('en-US')}`
}

function formatDate(isoDate) {
  if (!isoDate) return 'an unspecified date'
  const d = new Date(`${isoDate}T00:00:00`)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function findNextOpenInstallment(schedule) {
  const open = (schedule || []).filter((r) => r.status !== 'paid')
  if (open.length === 0) return null
  return [...open].sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
}

function isOverdue(row, asOfDate) {
  if (!row) return false
  return row.due_date < asOfDate.toISOString().slice(0, 10)
}

function summarizeScheduleCounts(schedule, asOfDate) {
  const rows = schedule || []
  const scheduled = rows.length
  const completed = rows.filter((r) => r.status === 'paid').length
  const remaining = rows.filter((r) => r.status !== 'paid').length
  const overdueRows = rows.filter((r) => r.status !== 'paid' && isOverdue(r, asOfDate))
  const lapsed = overdueRows.length
  const overdueAmount = roundPeso(overdueRows.reduce((s, r) => s + (Number(r.total_due) - Number(r.amount_paid)), 0))
  return { scheduled, completed, remaining, lapsed, overdueAmount }
}

const SMS_TEMPLATES = {
  loan_approval(ctx) {
    const { loan, borrower } = ctx
    return {
      ok: true,
      message:
        `Hello ${borrower.full_name}, your loan ${loan.loan_number} for ${formatPeso(loan.principal_amount)} ` +
        `has been approved. We'll follow up with disbursement details shortly.`
    }
  },

  payment_reminder(ctx) {
    const { borrower, next } = ctx
    if (!next) return { ok: false, error: 'This loan has no upcoming installment to remind about — it may already be fully paid.' }
    const owed = Number(next.total_due) - Number(next.amount_paid)
    return {
      ok: true,
      message:
        `Hello ${borrower.full_name}, this is a reminder that your loan payment of ${formatPeso(owed)} ` +
        `is due on ${formatDate(next.due_date)}. Please contact us if you have already made the payment.`
    }
  },

  due_date_reminder(ctx) {
    const { borrower, next } = ctx
    if (!next) return { ok: false, error: 'This loan has no upcoming due date — it may already be fully paid.' }
    const owed = Number(next.total_due) - Number(next.amount_paid)
    return {
      ok: true,
      message:
        `Hello ${borrower.full_name}, your next payment of ${formatPeso(owed)} is due on ${formatDate(next.due_date)}. ` +
        `Please settle it on or before the due date.`
    }
  },

  overdue_notice(ctx) {
    const { borrower, next } = ctx
    if (!next || !isOverdue(next, new Date())) {
      return { ok: false, error: 'This loan has no overdue installment right now.' }
    }
    const owed = Number(next.total_due) - Number(next.amount_paid)
    return {
      ok: true,
      message:
        `Hello ${borrower.full_name}, your payment of ${formatPeso(owed)} was due on ${formatDate(next.due_date)} ` +
        `and is now overdue. Please settle this as soon as possible to avoid additional penalties.`
    }
  },

  payment_received(ctx) {
    const { borrower, latestPayment } = ctx
    if (!latestPayment) return { ok: false, error: 'No payments have been recorded on this loan yet.' }
    return {
      ok: true,
      message:
        `Hello ${borrower.full_name}, we have received your payment of ${formatPeso(latestPayment.amount)} ` +
        `on ${formatDate(latestPayment.payment_date)}. Thank you!`
    }
  },

  // Loan-scoped balance summary — "This Loan" scope. For the borrower-level
  // "All Active Loans" scope, see buildOverallSummaryMessage() below, which
  // this same sms_type routes to when the request carries borrower_id
  // instead of loan_id.
  loan_balance_summary(ctx) {
    const { loan, borrower, schedule, payments } = ctx
    const { totalPayable } = computeLoanTotals(loan)
    const totalPaid = roundPeso((payments || []).reduce((s, p) => s + Number(p.amount), 0))
    const remaining = Math.max(0, roundPeso(totalPayable - totalPaid))
    const counts = summarizeScheduleCounts(schedule, new Date())
    const overduePart = counts.lapsed > 0
      ? ` ${counts.lapsed} installment${counts.lapsed === 1 ? '' : 's'} overdue (${formatPeso(counts.overdueAmount)}).`
      : ''
    return {
      ok: true,
      message:
        `Hello ${borrower.full_name}, Loan ${loan.loan_number} balance summary — Original: ${formatPeso(loan.principal_amount)}, ` +
        `Remaining: ${formatPeso(remaining)}. Payments: ${counts.completed}/${counts.scheduled} completed.` + overduePart
    }
  },

  general(ctx) {
    const { borrower, loan } = ctx
    return {
      ok: true,
      message: `Hello ${borrower.full_name}, this is a message regarding your loan ${loan.loan_number}. Please contact us for more details.`
    }
  }
}

const VALID_SMS_TYPES = Object.keys(SMS_TEMPLATES)

const SMS_SENDER_PREFIX = 'JBSARIO Microfinance: '

function buildMessage(smsType, ctx) {
  const template = SMS_TEMPLATES[smsType]
  if (!template) return { ok: false, error: `Unknown SMS type: ${smsType}` }
  return template(ctx)
}

// Borrower-scoped "Overall Loan Summary" (loan_balance_summary + borrower_id,
// no loan_id). Fetches every active/defaulted loan for the borrower and
// every payment across just those loans in TWO batched queries — never a
// per-loan loop, and never a joined query that would multiply loan rows by
// payment rows — then aggregates in JS so nothing is double-counted.
async function buildOverallSummaryMessage(callerClient, borrower) {
  const { data: loans, error: loansErr } = await callerClient
    .from('lend_loans')
    .select('*')
    .eq('borrower_id', borrower.id)
    .eq('deleted', false)
    .in('status', ['active', 'defaulted'])
    .order('created', { ascending: true })

  if (loansErr) return { ok: false, error: "Could not load this borrower's loans." }
  if (!loans || loans.length === 0) {
    return { ok: false, error: 'This borrower has no active or defaulted loans to summarize.' }
  }

  const loanIds = loans.map((l) => l.id)
  const { data: allPayments } = await callerClient
    .from('lend_payments')
    .select('loan_id, amount')
    .in('loan_id', loanIds)

  const paidByLoan = {}
  for (const p of (allPayments || [])) {
    paidByLoan[p.loan_id] = roundPeso((paidByLoan[p.loan_id] || 0) + Number(p.amount))
  }

  let totalPayableSum = 0
  let totalPaidSum = 0
  const lines = []

  for (const loan of loans) {
    const { totalPayable } = computeLoanTotals(loan)
    const paid = paidByLoan[loan.id] || 0
    const remaining = Math.max(0, roundPeso(totalPayable - paid))
    totalPayableSum += totalPayable
    totalPaidSum += paid
    lines.push(`Loan ${loan.loan_number}: Orig ${formatPeso(loan.principal_amount)}, Rem ${formatPeso(remaining)}`)
  }

  const totalRemaining = Math.max(0, roundPeso(totalPayableSum - totalPaidSum))

  const message =
    `Hello ${borrower.full_name}, Overall Loan Summary — Active Loans: ${loans.length}. ` +
    lines.join('; ') + `. TOTAL REMAINING BALANCE: ${formatPeso(totalRemaining)}.`

  return { ok: true, message, meta: { active_loans: loans.length, total_remaining_balance: totalRemaining } }
}

// ---------- SMS Gateway for Android (capcom6/android-sms-gateway) ----------
// Real API confirmed against the official docs — not guessed:
//   POST /3rdparty/v1/messages, HTTP Basic Auth (username:password, not a
//   bearer API key), body { textMessage: { text }, phoneNumbers: [...] }.
//   https://docs.sms-gate.app/features/sending-messages/
//   https://docs.sms-gate.app/features/status-tracking/
//   https://docs.sms-gate.app/integration/authentication/

function mapGatewayState(state) {
  if (state === 'Failed' || state === 'Cancelled') return 'failed'
  if (state === 'Delivered') return 'delivered'
  if (state === 'Sent' || state === 'Processed') return 'sent'
  return 'pending'
}

async function sendViaGateway(phoneE164, message) {
  const baseUrl = Deno.env.get('SMS_GATEWAY_API_URL') || DEFAULT_GATEWAY_BASE_URL
  const username = Deno.env.get('SMS_GATEWAY_USERNAME')
  const password = Deno.env.get('SMS_GATEWAY_PASSWORD')
  const deviceId = Deno.env.get('SMS_GATEWAY_DEVICE_ID')

  if (!username || !password) {
    return {
      ok: false,
      status: 'failed',
      messageId: null,
      diagnostic: 'SMS_GATEWAY_USERNAME/SMS_GATEWAY_PASSWORD not set as Supabase secrets.',
      userMessage: 'SMS gateway is not configured. Contact your administrator.'
    }
  }

  const body = { textMessage: { text: message }, phoneNumbers: [phoneE164] }
  if (deviceId) body.deviceId = deviceId

  let response
  try {
    response = await fetch(`${baseUrl}/3rdparty/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + btoa(`${username}:${password}`)
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
    })
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      status: 'failed',
      messageId: null,
      diagnostic: String(err),
      userMessage: timedOut
        ? 'The SMS gateway timed out. The Android device may be offline or unreachable.'
        : 'Could not reach the SMS gateway.'
    }
  }

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    let userMessage = 'Failed to send SMS via the gateway.'
    if (response.status === 401) userMessage = 'SMS gateway rejected the configured credentials.'
    else if (response.status === 503) userMessage = 'SMS gateway is busy (device offline or queue full). Try again shortly.'
    return {
      ok: false,
      status: 'failed',
      messageId: data?.id ?? null,
      diagnostic: `HTTP ${response.status}: ${JSON.stringify(data)}`,
      userMessage
    }
  }

  const mappedStatus = mapGatewayState(data?.state)
  return {
    ok: mappedStatus !== 'failed',
    status: mappedStatus,
    messageId: data?.id ?? null,
    diagnostic: null,
    userMessage: mappedStatus === 'failed' ? 'The gateway accepted the request but reported it failed.' : null
  }
}

// ---------- Request handler ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  try {
    // ---------- 1. Authentication ----------
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ success: false, message: 'You must be signed in to send SMS.' }, 401)
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) {
      return json({ success: false, message: 'Your session has expired. Please sign in again.' }, 401)
    }
    const user = userData.user

    // ---------- 2. Input validation ----------
    let payload
    try {
      payload = await req.json()
    } catch {
      return json({ success: false, message: 'Invalid request body.' }, 400)
    }

    const { loan_id: loanId, borrower_id: borrowerId, sms_type: smsType, preview } = payload || {}

    if (!smsType || !VALID_SMS_TYPES.includes(smsType)) {
      return json({ success: false, message: `Invalid sms_type. Must be one of: ${VALID_SMS_TYPES.join(', ')}.` }, 400)
    }
    if (loanId && borrowerId) {
      return json({ success: false, message: 'Provide either loan_id or borrower_id, not both.' }, 400)
    }
    if (!loanId && !borrowerId) {
      return json({ success: false, message: 'Missing loan_id or borrower_id.' }, 400)
    }
    if (loanId && typeof loanId !== 'string') {
      return json({ success: false, message: 'Invalid loan_id.' }, 400)
    }
    if (borrowerId && typeof borrowerId !== 'string') {
      return json({ success: false, message: 'Invalid borrower_id.' }, 400)
    }
    // Only loan_balance_summary supports the borrower-level "All Active
    // Loans" scope — every other type is inherently about one specific
    // loan's own event (a specific installment, a specific payment).
    if (borrowerId && smsType !== 'loan_balance_summary') {
      return json({ success: false, message: 'Only Loan Balance Summary supports the "All Active Loans" scope.' }, 422)
    }

    // ---------- 3. Authorization + data fetch ----------
    // Queried with the CALLER's client, so this is subject to the same RLS
    // the rest of the app already enforces — not a fabricated stricter rule.
    let loan = null
    let borrower = null
    let schedule = []
    let payments = []
    let next = null

    if (loanId) {
      const { data: loanRow, error: loanErr } = await callerClient
        .from('lend_loans')
        .select('*, borrowers:lend_borrowers(*)')
        .eq('id', loanId)
        .eq('deleted', false)
        .single()

      if (loanErr || !loanRow) {
        return json({ success: false, message: 'Loan not found or you do not have access to it.' }, 404)
      }
      if (loanRow.group_id) {
        return json({ success: false, message: 'Group loans do not support SMS notifications yet — send to individual borrowers only.' }, 422)
      }
      loan = loanRow
      borrower = loan.borrowers
      if (!borrower) {
        return json({ success: false, message: 'This loan has no borrower on file.' }, 422)
      }
    } else {
      const { data: borrowerRow, error: borrowerErr } = await callerClient
        .from('lend_borrowers')
        .select('*')
        .eq('id', borrowerId)
        .single()

      if (borrowerErr || !borrowerRow) {
        return json({ success: false, message: 'Borrower not found or you do not have access to it.' }, 404)
      }
      borrower = borrowerRow
    }

    // ---------- 4. Phone validation ----------
    const phoneResult = normalizePhilippineNumber(borrower.contact_number)
    if (!phoneResult.ok) {
      return json({ success: false, message: phoneResult.error }, 422)
    }

    // ---------- 5. Build the message ----------
    let built
    if (loanId) {
      const { data: scheduleRows } = await callerClient.from('lend_repayment_schedule').select('*').eq('loan_id', loanId)
      schedule = scheduleRows || []
      const { data: paymentRows } = await callerClient
        .from('lend_payments')
        .select('*')
        .eq('loan_id', loanId)
        .order('payment_date', { ascending: false })
      payments = paymentRows || []
      next = findNextOpenInstallment(schedule)
      const latestPayment = payments[0] ?? null
      built = buildMessage(smsType, { loan, borrower, schedule, payments, latestPayment, next })
    } else {
      built = await buildOverallSummaryMessage(callerClient, borrower)
    }

    if (!built.ok) {
      return json({ success: false, message: built.error }, 422)
    }

    const finalMessage = SMS_SENDER_PREFIX + built.message

    // ---------- 6. Preview mode ----------
    if (preview) {
      return json({
        success: true,
        preview: {
          borrower_name: borrower.full_name,
          phone: phoneResult.normalized,
          message: finalMessage,
          scope: loanId ? 'loan' : 'borrower',
          loan_number: loanId ? loan.loan_number : null,
          active_loans: loanId ? null : (built.meta?.active_loans ?? null)
        }
      })
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ---------- 7. Duplicate-send guard ----------
    // Event-scoped (tied to a specific installment or payment) when
    // possible — this is what makes it safe for a future daily automation
    // run to evaluate the same loan every day without re-notifying the same
    // event. Falls back to a short time-window guard (accidental
    // double-click) for types with no single event to key on.
    let eventKey = null
    if (loanId) {
      if (smsType === 'payment_received' && payments[0]) {
        eventKey = { schedule_id: null, payment_id: payments[0].id }
      } else if (['payment_reminder', 'due_date_reminder', 'overdue_notice'].includes(smsType) && next) {
        eventKey = { schedule_id: next.id, payment_id: null }
      }
    }

    if (eventKey) {
      // A given payment is only ever announced once, period — no window.
      const permanent = smsType === 'payment_received'
      let dupQuery = serviceClient.from('lend_sms_logs').select('id').eq('loan_id', loanId).eq('sms_type', smsType)
      if (eventKey.schedule_id) dupQuery = dupQuery.eq('schedule_id', eventKey.schedule_id)
      if (eventKey.payment_id) dupQuery = dupQuery.eq('payment_id', eventKey.payment_id)
      if (!permanent) {
        const sinceEventIso = new Date(Date.now() - EVENT_DUPLICATE_WINDOW_MS).toISOString()
        dupQuery = dupQuery.gte('created', sinceEventIso)
      }
      const { data: dupes } = await dupQuery.limit(1)
      if (dupes && dupes.length > 0) {
        return json({ success: false, message: 'This SMS was already sent for this specific installment/payment recently.' }, 429)
      }
    } else {
      const sinceIso = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
      let dupQuery = serviceClient
        .from('lend_sms_logs')
        .select('id')
        .eq('sms_type', smsType)
        .eq('recipient', phoneResult.normalized)
        .gte('created', sinceIso)
      dupQuery = loanId ? dupQuery.eq('loan_id', loanId) : dupQuery.is('loan_id', null).eq('borrower_id', borrower.id)
      const { data: dupes } = await dupQuery.limit(1)
      if (dupes && dupes.length > 0) {
        return json({ success: false, message: 'A similar SMS was just sent. Please wait a moment before sending again.' }, 429)
      }
    }

    // ---------- 8. Send via gateway ----------
    const gatewayResult = await sendViaGateway(phoneResult.normalized, finalMessage)
    if (gatewayResult.diagnostic) {
      console.error('SMS gateway error:', gatewayResult.diagnostic)
    }

    // ---------- 9. Log the attempt ----------
    const { data: logRow, error: logErr } = await serviceClient
      .from('lend_sms_logs')
      .insert({
        loan_id: loanId || null,
        borrower_id: borrower.id,
        schedule_id: eventKey?.schedule_id ?? null,
        payment_id: eventKey?.payment_id ?? null,
        recipient: phoneResult.normalized,
        message: finalMessage,
        sms_type: smsType,
        status: gatewayResult.status,
        gateway_message_id: gatewayResult.messageId,
        error_message: gatewayResult.ok ? null : (gatewayResult.userMessage || 'Failed to send SMS'),
        sent_by: user.id,
        sent_by_email: user.email || '',
        sent_at: gatewayResult.ok ? new Date().toISOString() : null
      })
      .select()
      .single()

    if (logErr) {
      console.error('Failed to write lend_sms_logs row:', logErr.message)
    }

    // ---------- 10. Respond ----------
    if (gatewayResult.ok) {
      return json({
        success: true,
        message: 'SMS sent successfully',
        sms_log_id: logRow?.id ?? null,
        gateway_message_id: gatewayResult.messageId ?? null
      })
    }

    return json({
      success: false,
      message: gatewayResult.userMessage || 'Failed to send SMS',
      sms_log_id: logRow?.id ?? null
    }, 502)
  } catch (err) {
    console.error('Unexpected error in send-sms:', err)
    return json({ success: false, message: 'Unexpected server error. Please try again.' }, 500)
  }
})
