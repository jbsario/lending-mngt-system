-- Ledger (lending-management-system) — Supabase backend setup
-- Run ONCE: Supabase dashboard → SQL Editor → New query → paste this → Run.
--
-- Every table is prefixed lend_ so it stays completely separate from any
-- other app's tables (e.g. All Nighty-9's `app_state`) sharing this project.
-- All access requires a signed-in user (RLS "to authenticated"), matching
-- the "any staff login can see everything" model the app was built with.

create extension if not exists pgcrypto;

-- ---------- Borrowers ----------
create table if not exists public.lend_borrowers (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  contact_number  text,
  email           text,
  address         text,
  id_type         text,
  id_number       text,
  notes           text,
  created         timestamptz not null default now(),
  updated         timestamptz not null default now()
);

-- ---------- Groups ----------
create table if not exists public.lend_borrower_groups (
  id                uuid primary key default gen_random_uuid(),
  group_name        text not null,
  meeting_schedule  text,
  notes             text,
  created           timestamptz not null default now(),
  updated           timestamptz not null default now()
);

create table if not exists public.lend_group_members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.lend_borrower_groups(id) on delete cascade,
  borrower_id  uuid not null references public.lend_borrowers(id) on delete cascade,
  created      timestamptz not null default now()
);

-- ---------- Loans ----------
create table if not exists public.lend_loans (
  id                    uuid primary key default gen_random_uuid(),
  loan_number           text not null unique,
  borrower_id           uuid references public.lend_borrowers(id),
  group_id              uuid references public.lend_borrower_groups(id),
  principal_amount      numeric not null,
  interest_rate         numeric not null,
  interest_method       text not null check (interest_method in ('flat', 'declining')),
  term_months           int not null,
  repayment_frequency   text not null check (repayment_frequency in ('weekly', 'biweekly', 'monthly')),
  disbursement_date     date,
  purpose               text,
  status                text not null default 'pending'
                          check (status in ('pending', 'active', 'completed', 'defaulted', 'written_off')),
  deleted               boolean not null default false,
  created               timestamptz not null default now(),
  updated               timestamptz not null default now()
);

-- ---------- Repayment schedule ----------
create table if not exists public.lend_repayment_schedule (
  id                 uuid primary key default gen_random_uuid(),
  loan_id            uuid not null references public.lend_loans(id) on delete cascade,
  installment_number int not null,
  due_date           date not null,
  principal_due      numeric not null,
  interest_due       numeric not null,
  total_due          numeric not null,
  amount_paid        numeric not null default 0,
  status             text not null default 'unpaid'
                       check (status in ('unpaid', 'partial', 'paid', 'overdue')),
  created            timestamptz not null default now(),
  updated            timestamptz not null default now()
);

-- ---------- Payments ----------
create table if not exists public.lend_payments (
  id              uuid primary key default gen_random_uuid(),
  loan_id         uuid not null references public.lend_loans(id),
  schedule_id     uuid references public.lend_repayment_schedule(id),
  amount          numeric not null,
  payment_date    date not null,
  payment_method  text,
  received_by     text,
  notes           text,
  created         timestamptz not null default now()
);

-- ---------- Documents ----------
create table if not exists public.lend_documents (
  id           uuid primary key default gen_random_uuid(),
  borrower_id  uuid references public.lend_borrowers(id),
  loan_id      uuid references public.lend_loans(id),
  doc_type     text,
  file_name    text,
  file_path    text not null, -- path inside the lend-documents storage bucket
  created      timestamptz not null default now()
);

-- ---------- Activity log ----------
-- Insert/select only — no update/delete policy, so history can't be
-- altered from the app once written (only a service-role key can).
create table if not exists public.lend_activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id),
  user_email  text,
  action      text not null,
  entity      text,
  record_id   text,
  summary     text,
  details     jsonb,
  created     timestamptz not null default now()
);

-- ---------- Row Level Security ----------
alter table public.lend_borrowers          enable row level security;
alter table public.lend_borrower_groups    enable row level security;
alter table public.lend_group_members      enable row level security;
alter table public.lend_loans              enable row level security;
alter table public.lend_repayment_schedule enable row level security;
alter table public.lend_payments           enable row level security;
alter table public.lend_documents          enable row level security;
alter table public.lend_activity_logs      enable row level security;

drop policy if exists "authenticated full access" on public.lend_borrowers;
create policy "authenticated full access" on public.lend_borrowers
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated full access" on public.lend_borrower_groups;
create policy "authenticated full access" on public.lend_borrower_groups
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated full access" on public.lend_group_members;
create policy "authenticated full access" on public.lend_group_members
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated full access" on public.lend_loans;
create policy "authenticated full access" on public.lend_loans
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated full access" on public.lend_repayment_schedule;
create policy "authenticated full access" on public.lend_repayment_schedule
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated full access" on public.lend_payments;
create policy "authenticated full access" on public.lend_payments
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated full access" on public.lend_documents;
create policy "authenticated full access" on public.lend_documents
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated read+insert" on public.lend_activity_logs;
create policy "authenticated read+insert" on public.lend_activity_logs
  for select to authenticated using (true);
create policy "authenticated insert" on public.lend_activity_logs
  for insert to authenticated with check (true);

-- ---------- Storage bucket for documents ----------
insert into storage.buckets (id, name, public)
values ('lend-documents', 'lend-documents', false)
on conflict (id) do nothing;

drop policy if exists "lend-documents authenticated access" on storage.objects;
create policy "lend-documents authenticated access" on storage.objects
  for all to authenticated
  using (bucket_id = 'lend-documents')
  with check (bucket_id = 'lend-documents');
