-- Ledger — migration 4: tag each repayment_schedule row with the frequency
-- it was generated under, so the UI can show a separate table per
-- daily/weekly/biweekly/monthly segment instead of one flat list that jumps
-- between amounts when a loan's frequency changes partway through.
-- Run ONCE: Supabase dashboard → SQL Editor → New query → paste this → Run.

alter table public.lend_repayment_schedule
  add column if not exists frequency text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lend_repayment_schedule_frequency_check'
  ) then
    alter table public.lend_repayment_schedule
      add constraint lend_repayment_schedule_frequency_check
      check (frequency is null or frequency in ('daily', 'weekly', 'biweekly', 'monthly'));
  end if;
end $$;

-- Backfill existing rows (created before this column existed) with their
-- loan's current frequency, as a reasonable best guess for display purposes.
update public.lend_repayment_schedule s
set frequency = l.repayment_frequency
from public.lend_loans l
where s.loan_id = l.id and s.frequency is null;
