// Supabase Edge Function: sms-scheduler
//
// Automated companion to send-sms. Where send-sms is triggered by a signed-in
// staff member clicking a button (authorized via their own JWT), this
// function is meant to be triggered by a cron job (Supabase pg_cron + pg_net)
// with NO human caller — there is no user JWT to scope authorization by, so
// it uses the service-role key directly. This is the one deliberate
// exception to "always scope by the caller's JWT" used everywhere else in
// this app's SMS code.
//
// IMPORTANT — this function does NOT run on a schedule by itself. Deploying
// it only makes it invocable; nothing calls it until you deliberately
// schedule it (see SMS_INTEGRATION.md for the exact `cron.schedule(...)` SQL
// and the manual test-invoke step you should do first). Real borrowers only
// receive SMS once you take that separate, explicit step.
//
// Multi-loan behavior: every active/defaulted loan is evaluated
// INDEPENDENTLY — a borrower with 3 loans can get a reminder for loan #1,
// nothing for loan #2, and an overdue notice for loan #3, all in the same
// run. Duplicate protection is keyed per (loan_id, sms_type, schedule_id),
// so re-running this daily never re-sends the same reminder for the same
// loan's same installment within 24h, while a DIFFERENT loan (or a
// different installment) is never blocked by that.
//
// Self-contained (no imports from sibling files or from send-sms/) — same
// reasoning as send-sms's header comment: the Dashboard editor doesn't
// reliably bundle relative-path imports pasted in as separate files.

import { createClient } from 'npm:@supabase/supabase-js@2'

const EVENT_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000
const GATEWAY_TIMEOUT_MS = 15000
const DEFAULT_GATEWAY_BASE_URL = 'https://api.sms-gate.app'
const SMS_SENDER_PREFIX = 'JBSARIO Microfinance: '
const AUTOMATION_SENDER_LABEL = 'Automated (Scheduler)'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function roundPeso(n) {
  return Math.round(n)
}

function formatPeso(amount) {
  return `₱${Math.round(Number(amount)).toLocaleString('en-US')}`
}

function formatDate(isoDate) {
  if (!isoDate) return 'an unspecified date'
  const d = new Date(`${isoDate}T00:00:00`)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function normalizePhilippineNumber(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, error: 'No phone number on file.' }
  const digitsOnly = raw.trim().replace(/[\s-]/g, '')
  if (digitsOnly.startsWith('+')) {
    if (/^\+\d{8,15}$/.test(digitsOnly)) return { ok: true, normalized: digitsOnly }
    return { ok: false, error: 'Not a valid international number.' }
  }
  if (/^09\d{9}$/.test(digitsOnly)) return { ok: true, normalized: `+63${digitsOnly.slice(1)}` }
  if (/^639\d{9}$/.test(digitsOnly)) return { ok: true, normalized: `+${digitsOnly}` }
  return { ok: false, error: 'Not a recognized Philippine mobile format.' }
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

function isDueTomorrow(row, asOfDate) {
  if (!row) return false
  const tomorrow = new Date(asOfDate)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return row.due_date === tomorrow.toISOString().slice(0, 10)
}

// Same wording as send-sms/index.ts's payment_reminder / overdue_notice
// templates, kept in sync by hand (see this file's header for why it isn't
// a shared import).
function buildReminderMessage(borrower, next) {
  const owed = Number(next.total_due) - Number(next.amount_paid)
  return (
    `Hello ${borrower.full_name}, this is a reminder that your loan payment of ${formatPeso(owed)} ` +
    `is due on ${formatDate(next.due_date)}. Please contact us if you have already made the payment.`
  )
}

function buildOverdueMessage(borrower, next) {
  const owed = Number(next.total_due) - Number(next.amount_paid)
  return (
    `Hello ${borrower.full_name}, your payment of ${formatPeso(owed)} was due on ${formatDate(next.due_date)} ` +
    `and is now overdue. Please settle this as soon as possible to avoid additional penalties.`
  )
}

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
    return { ok: false, status: 'failed', messageId: null, userMessage: 'SMS gateway is not configured.' }
  }

  const body = { textMessage: { text: message }, phoneNumbers: [phoneE164] }
  if (deviceId) body.deviceId = deviceId

  let response
  try {
    response = await fetch(`${baseUrl}/3rdparty/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(`${username}:${password}`) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
    })
  } catch (err) {
    return { ok: false, status: 'failed', messageId: null, userMessage: `Gateway unreachable: ${String(err)}` }
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    return { ok: false, status: 'failed', messageId: data?.id ?? null, userMessage: `Gateway HTTP ${response.status}` }
  }

  const mappedStatus = mapGatewayState(data?.state)
  return { ok: mappedStatus !== 'failed', status: mappedStatus, messageId: data?.id ?? null, userMessage: null }
}

// Every eligible SMS for one loan, evaluated in isolation from every other
// loan (including other loans belonging to the same borrower).
async function evaluateLoan(serviceClient, loan) {
  const borrower = loan.borrowers
  const results = []

  if (loan.group_id || !borrower) return results

  const phoneResult = normalizePhilippineNumber(borrower.contact_number)
  if (!phoneResult.ok) {
    results.push({ loan_id: loan.id, loan_number: loan.loan_number, action: 'skipped', reason: phoneResult.error })
    return results
  }

  const { data: schedule } = await serviceClient.from('lend_repayment_schedule').select('*').eq('loan_id', loan.id)
  const next = findNextOpenInstallment(schedule || [])
  if (!next) return results

  const today = new Date()
  let smsType = null
  let message = null
  if (isOverdue(next, today)) {
    smsType = 'overdue_notice'
    message = buildOverdueMessage(borrower, next)
  } else if (isDueTomorrow(next, today)) {
    smsType = 'payment_reminder'
    message = buildReminderMessage(borrower, next)
  }

  if (!smsType) return results

  // Duplicate guard — same (loan_id, sms_type, schedule_id) within 24h,
  // identical to send-sms's event-based guard for these two types.
  const sinceIso = new Date(Date.now() - EVENT_DUPLICATE_WINDOW_MS).toISOString()
  const { data: dupes } = await serviceClient
    .from('lend_sms_logs')
    .select('id')
    .eq('loan_id', loan.id)
    .eq('sms_type', smsType)
    .eq('schedule_id', next.id)
    .gte('created', sinceIso)
    .limit(1)

  if (dupes && dupes.length > 0) {
    results.push({ loan_id: loan.id, loan_number: loan.loan_number, action: 'skipped', reason: 'already sent for this installment within 24h' })
    return results
  }

  const finalMessage = SMS_SENDER_PREFIX + message
  const gatewayResult = await sendViaGateway(phoneResult.normalized, finalMessage)

  await serviceClient.from('lend_sms_logs').insert({
    loan_id: loan.id,
    borrower_id: borrower.id,
    schedule_id: next.id,
    payment_id: null,
    recipient: phoneResult.normalized,
    message: finalMessage,
    sms_type: smsType,
    status: gatewayResult.status,
    gateway_message_id: gatewayResult.messageId,
    error_message: gatewayResult.ok ? null : (gatewayResult.userMessage || 'Failed to send SMS'),
    sent_by: null,
    sent_by_email: AUTOMATION_SENDER_LABEL,
    sent_at: gatewayResult.ok ? new Date().toISOString() : null
  })

  results.push({
    loan_id: loan.id,
    loan_number: loan.loan_number,
    action: gatewayResult.ok ? 'sent' : 'failed',
    sms_type: smsType,
    reason: gatewayResult.ok ? null : gatewayResult.userMessage
  })
  return results
}

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  // No human caller here (this is meant to be invoked by pg_cron, not a
  // browser), so there's no user JWT to check. Instead, require the
  // service-role key itself as the bearer token — a secret only you (and
  // your own cron job's net.http_post call) hold, never shipped to the
  // frontend. This is what stops a random internet request from triggering
  // real SMS sends to your borrowers.
  const authHeader = req.headers.get('Authorization') || ''
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return json({ success: false, message: 'Unauthorized.' }, 401)
  }

  try {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: loans, error: loansErr } = await serviceClient
      .from('lend_loans')
      .select('*, borrowers:lend_borrowers(*)')
      .eq('deleted', false)
      .in('status', ['active', 'defaulted'])

    if (loansErr) {
      console.error('sms-scheduler: failed to load loans:', loansErr.message)
      return json({ success: false, message: 'Failed to load loans.' }, 500)
    }

    const allResults = []
    // Every loan is evaluated one at a time, independently — a borrower
    // with several loans simply appears more than once in this loop, each
    // time judged only against that one loan's own schedule.
    for (const loan of (loans || [])) {
      const results = await evaluateLoan(serviceClient, loan)
      allResults.push(...results)
    }

    return json({
      success: true,
      evaluated: (loans || []).length,
      sent: allResults.filter((r) => r.action === 'sent').length,
      skipped: allResults.filter((r) => r.action === 'skipped').length,
      failed: allResults.filter((r) => r.action === 'failed').length,
      details: allResults
    })
  } catch (err) {
    console.error('Unexpected error in sms-scheduler:', err)
    return json({ success: false, message: 'Unexpected server error.' }, 500)
  }
})
