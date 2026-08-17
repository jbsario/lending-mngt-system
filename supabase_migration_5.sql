-- Ledger — migration 5: SMS notification log.
-- Run ONCE: Supabase dashboard → SQL Editor → New query → paste this → Run.
-- Safe to run even if partially applied already (uses IF NOT EXISTS guards).

-- Immutable log of every SMS send attempt. Rows are written exclusively by
-- the send-sms Edge Function using the service-role key (which bypasses
-- RLS) — see the RLS policy below for why `authenticated` has no
-- insert/update/delete grant here, unlike most other tables in this schema.
-- sent_by_email mirrors lend_activity_logs' user_id + user_email pattern —
-- auth.users isn't embeddable via PostgREST like the public tables are, so
-- the email is denormalized here for the "Sent By" column in the UI.
create table if not exists public.lend_sms_logs (
  id                  uuid primary key default gen_random_uuid(),
  loan_id             uuid references public.lend_loans(id),
  borrower_id         uuid references public.lend_borrowers(id),
  recipient           text not null,
  message             text not null,
  sms_type            text not null check (sms_type in
                        ('loan_approval', 'payment_reminder', 'payment_received',
                         'due_date_reminder', 'overdue_notice', 'general')),
  status              text not null default 'pending'
                        check (status in ('pending', 'sent', 'delivered', 'failed')),
  gateway_message_id  text,
  error_message       text,
  sent_by             uuid references auth.users(id),
  sent_by_email       text,
  sent_at             timestamptz,
  created             timestamptz not null default now()
);

alter table public.lend_sms_logs enable row level security;

drop policy if exists "authenticated read" on public.lend_sms_logs;
create policy "authenticated read" on public.lend_sms_logs
  for select to authenticated using (true);

-- Deliberately no insert/update/delete policy for the `authenticated` role.
-- Every write happens server-side in the send-sms Edge Function via the
-- service-role key, which bypasses RLS entirely — the frontend must never be
-- able to write a fake "sent" row, or send SMS through any path except that
-- function. This is a tighter variant of the lend_activity_logs pattern
-- (which does allow client-side insert), justified because SMS sending is
-- explicitly required to be un-spoofable from the browser.

create index if not exists lend_sms_logs_loan_id_idx on public.lend_sms_logs (loan_id);
create index if not exists lend_sms_logs_created_idx on public.lend_sms_logs (created desc);
