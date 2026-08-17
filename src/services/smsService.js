// Frontend wrapper for the send-sms Edge Function. The browser never talks
// to the SMS gateway directly and never holds its credentials — it only
// ever sends { loan_id, sms_type } and lets the Edge Function look up the
// borrower/loan and generate the message itself.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

async function readFriendlyMessage(error, fallback) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (body?.message) return body.message
    } catch {
      // response wasn't JSON — fall through to the generic message
    }
  }
  return fallback
}

// Fetches what the message WOULD say, without sending it or logging
// anything — powers the confirmation dialog's preview. Uses the exact same
// server-side template logic as sendLoanSms, so the preview can't drift
// from what actually gets sent.
export async function previewLoanSms({ loanId, smsType }) {
  const { data, error } = await supabase.functions.invoke('send-sms', {
    body: { loan_id: loanId, sms_type: smsType, preview: true }
  })
  if (error) {
    throw new Error(await readFriendlyMessage(error, 'Could not build the SMS preview. Please try again.'))
  }
  if (!data?.success) {
    throw new Error(data?.message || 'Could not build the SMS preview.')
  }
  return data.preview // { borrower_name, phone, message }
}

// Actually sends the SMS and records it in lend_sms_logs.
export async function sendLoanSms({ loanId, smsType }) {
  const { data, error } = await supabase.functions.invoke('send-sms', {
    body: { loan_id: loanId, sms_type: smsType }
  })
  if (error) {
    throw new Error(await readFriendlyMessage(error, 'Failed to send SMS. Please try again.'))
  }
  if (!data?.success) {
    throw new Error(data?.message || 'Failed to send SMS.')
  }
  return data // { success, message, sms_log_id, gateway_message_id }
}
