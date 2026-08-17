// Supabase Edge Function: send-sms
//
// React frontend never talks to the SMS gateway or holds its credentials.
// The frontend sends only { loan_id, sms_type }; this function looks up the
// loan/borrower itself, generates the message from a fixed template, and is
// the only place gateway credentials (Supabase secrets) are ever read.
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

// ---------- Centralized SMS templates ----------
// Each is a pure function of loan/borrower/schedule data already fetched
// below; none accept free text from the caller.

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
    const { borrower, schedule } = ctx
    const next = findNextOpenInstallment(schedule)
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
    const { borrower, schedule } = ctx
    const next = findNextOpenInstallment(schedule)
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
    const { borrower, schedule } = ctx
    const next = findNextOpenInstallment(schedule)
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
  const result = template(ctx)
  if (!result.ok) return result
  return { ok: true, message: SMS_SENDER_PREFIX + result.message }
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

    const { loan_id: loanId, sms_type: smsType, preview } = payload || {}

    if (!loanId || typeof loanId !== 'string') {
      return json({ success: false, message: 'Missing or invalid loan_id.' }, 400)
    }
    if (!smsType || !VALID_SMS_TYPES.includes(smsType)) {
      return json({ success: false, message: `Invalid sms_type. Must be one of: ${VALID_SMS_TYPES.join(', ')}.` }, 400)
    }

    // ---------- 3. Loan authorization ----------
    // Queried with the CALLER's client, so this is subject to the same RLS
    // the rest of the app already enforces — not a fabricated stricter rule.
    const { data: loan, error: loanErr } = await callerClient
      .from('lend_loans')
      .select('*, borrowers:lend_borrowers(*)')
      .eq('id', loanId)
      .eq('deleted', false)
      .single()

    if (loanErr || !loan) {
      return json({ success: false, message: 'Loan not found or you do not have access to it.' }, 404)
    }

    if (loan.group_id) {
      return json({ success: false, message: 'Group loans do not support SMS notifications yet — send to individual borrowers only.' }, 422)
    }

    const borrower = loan.borrowers
    if (!borrower) {
      return json({ success: false, message: 'This loan has no borrower on file.' }, 422)
    }

    // ---------- 4. Phone validation ----------
    const phoneResult = normalizePhilippineNumber(borrower.contact_number)
    if (!phoneResult.ok) {
      return json({ success: false, message: phoneResult.error }, 422)
    }

    // ---------- 5. Load data needed for the template ----------
    const { data: schedule } = await callerClient
      .from('lend_repayment_schedule')
      .select('*')
      .eq('loan_id', loanId)

    let latestPayment = null
    if (smsType === 'payment_received') {
      const { data: payments } = await callerClient
        .from('lend_payments')
        .select('*')
        .eq('loan_id', loanId)
        .order('payment_date', { ascending: false })
        .limit(1)
      latestPayment = payments?.[0] ?? null
    }

    // ---------- 6. Generate message ----------
    const built = buildMessage(smsType, { loan, borrower, schedule: schedule || [], latestPayment })
    if (!built.ok) {
      return json({ success: false, message: built.error }, 422)
    }

    // ---------- 7. Preview mode ----------
    if (preview) {
      return json({
        success: true,
        preview: {
          borrower_name: borrower.full_name,
          phone: phoneResult.normalized,
          message: built.message
        }
      })
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ---------- 8. Duplicate-send guard ----------
    const sinceIso = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
    const { data: recentDuplicates } = await serviceClient
      .from('lend_sms_logs')
      .select('id')
      .eq('loan_id', loanId)
      .eq('sms_type', smsType)
      .eq('recipient', phoneResult.normalized)
      .gte('created', sinceIso)
      .limit(1)

    if (recentDuplicates && recentDuplicates.length > 0) {
      return json({ success: false, message: 'A similar SMS was just sent for this loan. Please wait a moment before sending again.' }, 429)
    }

    // ---------- 9. Send via gateway ----------
    const gatewayResult = await sendViaGateway(phoneResult.normalized, built.message)
    if (gatewayResult.diagnostic) {
      console.error('SMS gateway error:', gatewayResult.diagnostic)
    }

    // ---------- 10. Log the attempt ----------
    const { data: logRow, error: logErr } = await serviceClient
      .from('lend_sms_logs')
      .insert({
        loan_id: loanId,
        borrower_id: borrower.id,
        recipient: phoneResult.normalized,
        message: built.message,
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

    // ---------- 11. Respond ----------
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
