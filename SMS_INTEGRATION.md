# SMS Notifications

Borrower SMS (payment reminders, overdue notices, etc.) send through your own Android phone acting
as an SMS gateway — via [SMS Gateway for Android™](https://github.com/capcom6/android-sms-gateway) —
so there's no per-message fee and no third-party SMS provider account. Gateway credentials never
reach the browser: they live only as Supabase Edge Function secrets.

```
React Frontend → Supabase Edge Function (send-sms) → SMS Gateway for Android → your phone → borrower
```

## 1. Set up the gateway app

1. Install "SMS Gateway for Android" on a phone with a SIM that can send SMS to your borrowers.
2. Register an account in the app (or at [sms-gate.app](https://sms-gate.app)) — this gives you the
   **username and password** the Edge Function will authenticate with. This is *not* a single API
   key; the gateway uses HTTP Basic Auth.
3. Keep the phone charged and connected to the internet (WiFi or mobile data) — it needs to stay
   reachable for the public cloud relay (`api.sms-gate.app`) to hand it messages.
4. If you register more than one device to the same account, note its **Device ID** from the
   dashboard — otherwise leave it blank and the gateway auto-picks a device.

## 2. Set Supabase secrets

In the Supabase Dashboard → **Edge Functions** → **Secrets**, add:

| Secret | Required | Value |
|---|---|---|
| `SMS_GATEWAY_USERNAME` | Yes | The username from step 1 |
| `SMS_GATEWAY_PASSWORD` | Yes | The password from step 1 |
| `SMS_GATEWAY_API_URL` | No | Only if self-hosting a private server instead of the public cloud relay. Defaults to `https://api.sms-gate.app`. |
| `SMS_GATEWAY_DEVICE_ID` | No | Only needed if you have more than one device registered to the account. |

**Never** put these in `.env`, `VITE_*` variables, or anywhere in `src/` — they must only exist as
Edge Function secrets. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` don't
need to be set manually — Supabase injects them into every Edge Function automatically.

## 3. Run the database migrations

Run these once each, in order, in the Supabase Dashboard → **SQL Editor** (same process as the other
`supabase_migration_N.sql` files in this repo):

1. `supabase_migration_5.sql` — creates the `lend_sms_logs` table.
2. `supabase_migration_6.sql` — adds `schedule_id`/`payment_id` columns to `lend_sms_logs` (used by
   the per-event duplicate guard, see below) and widens `sms_type` to allow `loan_balance_summary`.

## 4. Deploy the Edge Functions

No Supabase CLI is required — deploy directly from the Dashboard. There are **two** functions:

**`send-sms`** (staff-triggered, from the app):
1. Supabase Dashboard → **Edge Functions** → **New Function**, name it `send-sms`.
2. Open the new function's code editor and replace its contents with the *entire* contents of this
   repo's `supabase/functions/send-sms/index.ts`. That one file is intentionally self-contained
   (no imports from sibling files) — the Dashboard editor doesn't reliably bundle relative-path
   imports across separate pasted-in files, so splitting the code up caused a
   `Module not found "file:///.../templates.ts"` deploy error the first time around. Paste the
   whole file as-is into the single `index.ts` the Dashboard gives you and it deploys cleanly.
3. Deploy.

**`sms-scheduler`** (optional, for automated reminders — see "Automated reminders" below):
1. Same process: **New Function**, name it exactly `sms-scheduler`, paste in the entire contents of
   `supabase/functions/sms-scheduler/index.ts`, Deploy.
2. This function does nothing on its own once deployed — nothing calls it until you explicitly
   schedule it. Deploying it is safe; scheduling it is the step that starts sending real SMS
   automatically, so that's covered separately below with its own explicit steps.

If you later install the Supabase CLI, `supabase functions deploy <name>` will work directly against
the `supabase/` folder already in this repo — `supabase/config.toml` is already set up for both
functions (`verify_jwt = false` for each, for different reasons — see "How it works" below).

## How it works

- The frontend (`src/services/smsService.js`) only ever sends `{ loan_id, sms_type }` for a
  loan-specific SMS, or `{ borrower_id, sms_type: 'loan_balance_summary' }` for the borrower-level
  "All Active Loans" summary — never both, never a phone number or free-text message. This means a
  compromised browser session can, at worst, trigger a *known template* SMS to a *specific loan's (or
  borrower's) real recipient*, not send arbitrary text to arbitrary numbers.
- The Edge Function re-derives everything itself: it authenticates the caller via their Supabase
  session token, re-fetches the loan/borrower/schedule (or, for a borrower-level request, the
  borrower's own active/defaulted loans) using **that caller's own JWT** (so it's bound by the same
  Row Level Security every other query in this app already uses), builds the message from a fixed
  template, and only then calls the gateway. Which of `loan_id`/`borrower_id` is present in the
  request — not a client-sent "scope" flag — is what determines whether it's a single-loan or
  all-loans send server-side.
- `verify_jwt = false` in `supabase/config.toml` is intentional, not a security hole, for `send-sms`:
  Supabase's platform-level JWT check runs *before* CORS preflight (`OPTIONS`) requests are handled,
  and browsers never attach an `Authorization` header to a preflight request — so `verify_jwt = true`
  breaks every browser call outright. Auth is instead checked explicitly inside `index.ts`
  (`supabase.auth.getUser()`), which is functionally equivalent and is Supabase's own documented
  pattern for this exact situation. `sms-scheduler` also has it off, but for a different reason — see
  "Automated reminders" below.
- `lend_sms_logs` grants `authenticated` **read-only** access via RLS — no insert/update/delete.
  Every log row is written by an Edge Function using the service-role key, which bypasses RLS.
  This means the browser can never fabricate a fake "sent" row, and can never write to this table
  through any path except an actual successful (or failed, logged) send.
- **Duplicate protection** is server-side and per-event, not just per-loan:
  - `payment_received` is keyed on `(loan_id, sms_type, payment_id)`, permanently — a given payment
    is only ever announced once. A *new* payment on the same loan gets a new `payment_id`, so it's
    never blocked.
  - `payment_reminder` / `due_date_reminder` / `overdue_notice` are keyed on
    `(loan_id, sms_type, schedule_id)` — the specific installment — blocked only if the same one was
    already sent within the last 24 hours. This is what makes it safe for `sms-scheduler` to
    re-evaluate every loan daily without re-notifying the same installment every day, while a
    *different* loan (or a different installment) is never affected by another loan's guard.
  - Everything else (`loan_balance_summary` in either scope, `loan_approval`, `general`) has no
    single event to key on, so it falls back to the original 30-second accidental-double-click
    window instead.
  - Disabling the "Send" button while a request is in flight is just UX — the real protection
    doesn't depend on the browser behaving.
- **Message preview** (shown in the confirmation dialog before sending) calls the *same* Edge
  Function with `preview: true`, which runs every step except the actual gateway call and log
  insert. This guarantees the preview can never drift from what actually gets sent.
- **Multi-loan totals are never double-counted**: the borrower-level summary fetches a borrower's
  loans once, then their payments once with a single `.in('loan_id', loanIds)` query (never a joined
  query that would multiply loan rows by payment rows), and aggregates per-loan in JS before summing.

## Multi-loan support

A borrower can have several loans — this was already true at the database level
(`lend_loans.borrower_id` has no unique constraint) and every existing template already built its
message from exactly one `loan_id`'s own schedule/payments, never combining loans. What this pass
added on top of that:

- **`/borrowers/:id`** (Borrower Detail page) — lists every loan the borrower has, each with its own
  Original/Remaining/Status and its own **View Loan** / **Send SMS** / **Payment History** / **Balance
  Summary** actions, plus a borrower-level **Send Overall Summary** button and SMS History table
  showing every loan's SMS together (with a Loan column) — distinct from a loan's own SMS History
  (`/loans/:id`), which only ever shows that one loan's messages.
- **`loan_balance_summary`** SMS type, with two scopes:
  - *This Loan* — `{ loan_id, sms_type: 'loan_balance_summary' }` — one loan's own Original/
    Remaining/payment-count summary.
  - *All Active Loans* — `{ borrower_id, sms_type: 'loan_balance_summary' }` — every
    `active`/`defaulted` loan for that borrower (matching the same "still owed" status filter
    `Payments.jsx`'s loan picker already uses — not `pending`/`completed`/`written_off`), listing each
    loan's Original/Remaining plus a grand total.
  - The confirmation modal (`src/components/SmsModal.jsx`) shows a "Summary Scope: This Loan / All
    Active Loans" radio only when both a specific loan and the borrower are in play (i.e. opened from
    a loan row on the Borrower Detail page) — from a loan's own page, or from the borrower page's top
    "Send Overall Summary" button, the scope is already implied and no radio is shown.

## Automated reminders (`sms-scheduler`)

A second Edge Function, `supabase/functions/sms-scheduler/index.ts`, evaluates **every** active/
defaulted loan independently — a borrower with 3 loans can get a reminder for loan #1, nothing for
loan #2, and an overdue notice for loan #3, all in one run — and sends `payment_reminder` for
installments due tomorrow or `overdue_notice` for overdue ones, using the same per-event 24h duplicate
guard described above.

**It ships deployed-but-dormant.** Deploying it only makes it callable; nothing invokes it until you
take the separate step below. Real borrowers only receive automated SMS once you deliberately enable
the schedule.

1. **Test-invoke it once manually first.** In the Supabase Dashboard → Edge Functions →
   `sms-scheduler`, invoke it directly (or `curl`) with header
   `Authorization: Bearer <your service_role key>` (Settings → API → `service_role` secret — this is
   the same key already used as `SUPABASE_SERVICE_ROLE_KEY`, just passed explicitly here since this
   function has no signed-in user to authenticate). It responds with a JSON summary
   (`{ evaluated, sent, skipped, failed, details: [...] }`) — inspect `details` and `lend_sms_logs`
   before doing anything further.
2. **Only once you're happy with what it sent**, enable the daily schedule yourself by running this in
   the SQL Editor (requires the `pg_cron` and `pg_net` extensions — enable them first under Database →
   Extensions if not already on):
   ```sql
   select cron.schedule(
     'sms-scheduler-daily',
     '0 9 * * *', -- 09:00 server time, every day — adjust to taste
     $$
     select net.http_post(
       url := 'https://xynhncminoqsnybzsqra.supabase.co/functions/v1/sms-scheduler',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
         'Content-Type', 'application/json'
       )
     );
     $$
   );
   ```
   You'll need to set `app.settings.service_role_key` (Database → Configuration, or
   `alter database postgres set app.settings.service_role_key = '<key>'`) rather than pasting the key
   directly into the SQL — keeps it out of anything that might log the query text.
3. To stop it later: `select cron.unschedule('sms-scheduler-daily');`.

I deliberately did not run step 2 myself — that's the point where the system starts texting real
borrowers on its own, unsupervised, and it's the same "explicit opt-in before a real send" boundary
this whole integration has followed from the start.

## Adding a new SMS template

Templates live in one place: the `SMS_TEMPLATES` object inside `supabase/functions/send-sms/index.ts`
(for loan-scoped types) plus `buildOverallSummaryMessage()` in the same file (for the borrower-scoped
"All Active Loans" summary). Each `SMS_TEMPLATES` entry is a function that receives
`{ loan, borrower, schedule, payments, latestPayment, next }` and returns `{ ok: true, message }` or
`{ ok: false, error }` (the `error` surfaces as a friendly validation message if the template's data
precondition isn't met — e.g. "no overdue installment").

To add a new type:
1. Add its key to the `check (sms_type in (...))` constraint in a new migration.
2. Add the matching key to `SMS_TEMPLATES` in `index.ts`, then **redeploy the function** (paste the
   updated file into the Dashboard editor again and Deploy — edits aren't picked up automatically).
   If it should also be reachable from the automated scheduler, add matching logic to
   `sms-scheduler/index.ts` and redeploy that too — the two functions duplicate their small helpers
   rather than sharing an import (see each file's header comment for why).
3. If you want it as a button in the UI, add it to the `SMS_TYPES` array at the top of
   `src/components/SmsModal.jsx` — both `LoanDetail.jsx` and `BorrowerDetail.jsx` pick it up
   automatically from there.

## Troubleshooting a failed send

1. Open the loan's **SMS History** section — a failed row shows its `error_message` inline.
2. Check the Edge Function's logs (Supabase Dashboard → Edge Functions → send-sms → Logs) for the
   full diagnostic detail (`console.error` calls in `index.ts`) — this is never sent to the browser,
   only logged server-side.
3. Common causes:
   - **"SMS gateway is not configured"** — `SMS_GATEWAY_USERNAME`/`SMS_GATEWAY_PASSWORD` secrets
     aren't set.
   - **"SMS gateway rejected the configured credentials"** — wrong username/password (HTTP 401 from
     the gateway).
   - **"SMS gateway is busy (device offline or queue full)"** — the phone isn't reachable, or its
     message queue is full (HTTP 503 from the gateway).
   - **"The SMS gateway timed out"** — no response within 15 seconds; usually the phone is offline.
   - A friendly validation message (e.g. "no overdue installment", "no phone number on file") means
     the request never reached the gateway at all — nothing to troubleshoot on the phone side.

## Row Level Security & auth summary

| Table | `authenticated` can... |
|---|---|
| `lend_sms_logs` | `SELECT` only. All writes go through the Edge Function's service-role key. |

The Edge Function itself enforces:
- A valid Supabase Auth session (`Authorization` header + `auth.getUser()`).
- Loan access scoped through the caller's own JWT — the same "any signed-in staff member has full
  access" model every other table in this app already uses, not a new stricter rule invented just
  for SMS.
- `loan_id`/`sms_type` are validated server-side; the borrower's phone number and the message text
  are always derived from the database, never accepted from the request body.
