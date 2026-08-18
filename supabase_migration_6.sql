-- Ledger — migration 6: multi-loan SMS support.
-- Run ONCE: Supabase dashboard → SQL Editor → New query → paste this → Run.
-- Safe to run even if partially applied already (uses IF NOT EXISTS guards).

-- A borrower can have several loans, each with its own payments and
-- schedule. These columns let one lend_sms_logs row identify exactly which
-- installment (schedule_id) or which payment (payment_id) it's about, so
-- duplicate-send protection can be scoped per event instead of just per
-- loan+type — see send-sms/index.ts's duplicate guard for how these are
-- used. Both are nullable: loan_approval/general/loan_balance_summary have
-- no single schedule row or payment to point at.
alter table public.lend_sms_logs
  add column if not exists schedule_id uuid references public.lend_repayment_schedule(id);
alter table public.lend_sms_logs
  add column if not exists payment_id uuid references public.lend_payments(id);

create index if not exists lend_sms_logs_schedule_id_idx on public.lend_sms_logs (schedule_id);
create index if not exists lend_sms_logs_payment_id_idx on public.lend_sms_logs (payment_id);

-- Widen the sms_type check constraint to add 'loan_balance_summary' — used
-- both loan-scoped (loan_id set) and borrower-scoped for the "All Active
-- Loans" overall summary (loan_id null, borrower_id set). The constraint's
-- auto-generated name isn't guaranteed, so look it up rather than assuming
-- lend_sms_logs_sms_type_check (same pattern as migration 2's
-- repayment_frequency widening).
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'lend_sms_logs'
    and con.contype = 'c'
    and att.attname = 'sms_type';

  if cname is not null then
    execute format('alter table public.lend_sms_logs drop constraint %I', cname);
  end if;

  alter table public.lend_sms_logs
    add constraint lend_sms_logs_sms_type_check
    check (sms_type in
      ('loan_approval', 'payment_reminder', 'payment_received',
       'due_date_reminder', 'overdue_notice', 'general', 'loan_balance_summary'));
end $$;
