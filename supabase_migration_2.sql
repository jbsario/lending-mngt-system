-- Ledger — migration 2: daily repayment frequency + late-payment penalty
-- Run ONCE: Supabase dashboard → SQL Editor → New query → paste this → Run.
-- Safe to run even if partially applied already (uses IF EXISTS / IF NOT EXISTS).

-- Track cumulative penalty payments per loan. The *accrued* penalty itself
-- is always computed fresh from the current outstanding balance and days
-- past the loan's maturity date (see src/lib/loanCalculations.js) — this
-- column only records how much of that accrued penalty has been paid off.
alter table public.lend_loans
  add column if not exists penalty_paid numeric not null default 0;

-- Widen the repayment_frequency check constraint to allow 'daily'. The
-- constraint's auto-generated name isn't guaranteed, so look it up rather
-- than assuming lend_loans_repayment_frequency_check.
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'lend_loans'
    and con.contype = 'c'
    and att.attname = 'repayment_frequency';

  if cname is not null then
    execute format('alter table public.lend_loans drop constraint %I', cname);
  end if;

  alter table public.lend_loans
    add constraint lend_loans_repayment_frequency_check
    check (repayment_frequency in ('daily', 'weekly', 'biweekly', 'monthly'));
end $$;
