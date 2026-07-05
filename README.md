# Ledger — Microfinance Lending Management System

A lending management system for individual and group (joint-liability) loans, with
borrower records, repayment schedules, payment tracking, and document uploads
(IDs, loan agreements). Backend is **PocketBase** — a single self-hosted binary
with an embedded SQLite database, built-in auth, and file storage. No project
limits, no monthly fee.

## Stack
- React 18 + Vite + Tailwind CSS
- PocketBase (database + auth + file storage, one binary)
- react-router-dom, lucide-react icons

## 1. Set up PocketBase (10 minutes)

1. Download the PocketBase binary for your OS from
   [pocketbase.io/docs](https://pocketbase.io/docs/) (no account needed).
2. Unzip it, then from that folder run:
   ```bash
   ./pocketbase serve
   ```
   (On Windows: `pocketbase.exe serve`)
3. Copy the `pb_migrations` folder from this project into the same folder as
   the `pocketbase` binary, then restart it. PocketBase automatically applies
   any migration files it finds on startup — this creates all 7 collections
   (borrowers, groups, loans, repayment schedule, payments, documents) with
   the right fields and permissions in one go.
4. Open `http://127.0.0.1:8090/_/` in your browser — this is the Admin UI.
   Create your admin/superuser account on first visit.
5. **If the migrations don't apply cleanly** (PocketBase's migration format
   changes between versions), use the fallback below: create each collection
   by hand in the Admin UI using the field reference table further down.
6. Create staff logins: in the Admin UI, go to **Collections → users → New
   record**, and add an email + password for yourself and each staff member.
   This is the built-in auth collection PocketBase ships with — no separate
   setup needed.

## 2. Configure the app

```bash
cp .env.example .env
```

By default `.env` points at `http://127.0.0.1:8090` for local development.
Update it once you deploy PocketBase somewhere permanent (step 4).

## 3. Run the app locally

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` and sign in with the staff account you created.

## 4. Deploy PocketBase somewhere permanent

PocketBase is one binary + one data folder, so it runs anywhere you can keep
a small process alive:

- **A cheap VPS** (DigitalOcean, Vultr, a spare machine) — copy the binary +
  `pb_migrations` folder over, run `./pocketbase serve --http=0.0.0.0:8090`,
  and put it behind a reverse proxy (Caddy or nginx) for HTTPS.
- **Fly.io / Railway** — both have free-tier-friendly plans that can run a
  persistent PocketBase container; search "deploy pocketbase fly.io" for an
  up-to-date guide, since exact steps shift as those platforms change.
- **A spare always-on PC at your office** — genuinely fine for an internal
  tool with a handful of staff users.

Whichever you choose, back up the `pb_data` folder regularly — it's a single
SQLite file plus uploaded documents, so backing it up is just copying that
folder.

## 5. Deploy the frontend

```bash
npm install -g vercel
vercel
```

Set `VITE_POCKETBASE_URL` in the Vercel project to your deployed PocketBase
URL (from step 4), then `vercel --prod`. Or push to GitHub and import the repo
in the Vercel dashboard — same environment variable goes under **Project
Settings → Environment Variables**.

## Collection field reference (manual fallback)

If you need to create collections by hand instead of via `pb_migrations`:

| Collection | Fields |
|---|---|
| `borrowers` | full_name (text, required), contact_number (text), email (email), address (text), id_type (text), id_number (text), notes (text) |
| `borrower_groups` | group_name (text, required), meeting_schedule (text), notes (text) |
| `group_members` | group (relation → borrower_groups, required), borrower (relation → borrowers, required) |
| `loans` | loan_number (text, required, unique), borrower (relation → borrowers), group (relation → borrower_groups), principal_amount (number, required), interest_rate (number, required), interest_method (select: flat/declining), term_months (number, required), repayment_frequency (select: weekly/biweekly/monthly), disbursement_date (date), purpose (text), status (select: pending/active/completed/defaulted/written_off) |
| `repayment_schedule` | loan (relation → loans, required), installment_number (number, required), due_date (date, required), principal_due (number, required), interest_due (number, required), total_due (number, required), amount_paid (number), status (select: unpaid/partial/paid/overdue) |
| `payments` | loan (relation → loans, required), schedule (relation → repayment_schedule), amount (number, required), payment_date (date, required), payment_method (text), received_by (text), notes (text) |
| `documents` | borrower (relation → borrowers), loan (relation → loans), doc_type (select: ID/Loan Agreement/Collateral/Other), file_name (text), file (file, required) |

For every collection, set **List/View/Create/Update/Delete rules** to
`@request.auth.id != ''` — this means only signed-in staff can touch the
data, matching what the migrations set up automatically.

## How it works

- **Borrowers** — individual records with ID type/number, contact info, and
  per-borrower document upload.
- **Groups** — joint-liability groups; add borrowers as members for group loans.
- **Loans** — create an individual or group loan, set principal, interest rate
  (flat or declining balance), term, and repayment frequency. Setting a
  disbursement date auto-generates the full repayment schedule.
- **Loan detail** — view/settle each installment, record partial or full
  payments, upload the signed loan agreement and borrower ID against that
  specific loan.
- **Payments** — running log of every payment across all loans.
- **Documents** — every uploaded file across all borrowers/loans in one place,
  filterable by type. Files live in PocketBase's storage; the app fetches a
  short-lived access token each time someone opens a file rather than using
  a permanent public link.

## Notes on interest calculation

- **Flat rate**: interest = principal × rate% × term (in months), spread evenly
  across every installment. Common for informal/microfinance lending.
- **Declining balance**: interest recalculated each period on the remaining
  principal — lowers total interest paid over the loan compared to flat rate.

Adjust the math in `src/lib/loanCalculations.js` if your actual lending terms
work differently (e.g. add processing fees, penalties for late payment, etc.).

## Security notes

- Every collection requires a signed-in user for read/write, matching the
  Row Level Security setup you'd get on a hosted database — but here it's
  entirely under your control since you own the server.
- There's currently no distinction between staff roles (e.g. branch-level
  access) — everyone with a login sees everything. Restricting further is a
  matter of adding a `role` field to `users` and tightening each collection's
  rules to check it.
- Back up `pb_data` regularly — unlike a managed database, there's no
  automatic backup unless you set one up yourself (a nightly cron copying the
  folder somewhere safe is enough for this scale).
