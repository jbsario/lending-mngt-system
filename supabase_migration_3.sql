-- Ledger — migration 3: fixes the daily-frequency constraint + adds a fixed
-- payment weekday (e.g. "every Saturday") for weekly/biweekly loans.
-- Run ONCE: Supabase dashboard → SQL Editor → New query → paste this → Run.
-- Safe to run even if migration 2 was already applied (uses IF EXISTS / IF NOT EXISTS).

-- Re-affirm: widen the repayment_frequency check constraint to allow 'daily'.
-- (This was shipped as supabase_migration_2.sql but was never run, which is
-- why editing a loan to "daily" failed with a check constraint violation.)
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

-- Also make sure penalty_paid exists (from migration 2) in case that one
-- was skipped too.
alter table public.lend_loans
  add column if not exists penalty_paid numeric not null default 0;

-- Fixed collection day for weekly/biweekly loans — 0=Sunday..6=Saturday.
-- Null means "whatever weekday falls out of the disbursement date", the
-- original behavior.
alter table public.lend_loans
  add column if not exists payment_weekday smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lend_loans_payment_weekday_check'
  ) then
    alter table public.lend_loans
      add constraint lend_loans_payment_weekday_check
      check (payment_weekday is null or payment_weekday between 0 and 6);
  end if;
end $$;
