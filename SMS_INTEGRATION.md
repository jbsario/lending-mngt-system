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

## 3. Run the database migration

Run `supabase_migration_5.sql` once in the Supabase Dashboard → **SQL Editor** (same process as the
other `supabase_migration_N.sql` files in this repo). It creates the `lend_sms_logs` table.

## 4. Deploy the Edge Function

No Supabase CLI is required — deploy directly from the Dashboard:

1. Supabase Dashboard → **Edge Functions** → **New Function**, name it `send-sms`.
2. Open the new function's code editor and replace its contents with the *entire* contents of this
   repo's `supabase/functions/send-sms/index.ts`. That one file is intentionally self-contained
   (no imports from sibling files) — the Dashboard editor doesn't reliably bundle relative-path
   imports across separate pasted-in files, so splitting the code up caused a
   `Module not found "file:///.../templates.ts"` deploy error the first time around. Paste the
   whole file as-is into the single `index.ts` the Dashboard gives you and it deploys cleanly.
3. Deploy.
4. If you later install the Supabase CLI, `supabase functions deploy send-sms` will work directly
   against the `supabase/` folder already in this repo — `supabase/config.toml` is already set up
   for it (with `verify_jwt = false` for that function — see "How it works" below for why).

## How it works

- The frontend (`src/services/smsService.js`) only ever sends `{ loan_id, sms_type }` to the
  Edge Function — never a phone number or free-text message. This means a compromised browser
  session can, at worst, trigger a *known template* SMS to a *specific loan's real borrower*, not
  send arbitrary text to arbitrary numbers.
- The Edge Function re-derives everything itself: it authenticates the caller via their Supabase
  session token, re-fetches the loan/borrower/schedule using **that caller's own JWT** (so it's
  bound by the same Row Level Security every other query in this app already uses), builds the
  message from a fixed template, and only then calls the gateway.
- `verify_jwt = false` in `supabase/config.toml` is intentional, not a security hole: Supabase's
  platform-level JWT check runs *before* CORS preflight (`OPTIONS`) requests are handled, and
  browsers never attach an `Authorization` header to a preflight request — so `verify_jwt = true`
  breaks every browser call outright. Auth is instead checked explicitly inside `index.ts`
  (`supabase.auth.getUser()`), which is functionally equivalent and is Supabase's own documented
  pattern for this exact situation.
- `lend_sms_logs` grants `authenticated` **read-only** access via RLS — no insert/update/delete.
  Every log row is written by the Edge Function using the service-role key, which bypasses RLS.
  This means the browser can never fabricate a fake "sent" row, and can never write to this table
  through any path except an actual successful (or failed, logged) send.
- **Duplicate protection** is server-side: before sending, the function checks for another log row
  with the same loan + SMS type + recipient created in the last 30 seconds, and rejects the request
  if one exists. Disabling the "Send" button while a request is in flight is just UX — the real
  protection doesn't depend on the browser behaving.
- **Message preview** (shown in the confirmation dialog before sending) calls the *same* Edge
  Function with `preview: true`, which runs every step except the actual gateway call and log
  insert. This guarantees the preview can never drift from what actually gets sent.

## Adding a new SMS template

Templates live in one place: the `SMS_TEMPLATES` object inside `supabase/functions/send-sms/index.ts`.
Each entry is a function that receives `{ loan, borrower, schedule, latestPayment }` and returns
`{ ok: true, message }` or `{ ok: false, error }` (the `error` surfaces as a friendly validation
message if the template's data precondition isn't met — e.g. "no overdue installment").

To add a new type:
1. Add its key to the `check (sms_type in (...))` constraint in a new migration
   (`supabase_migration_6.sql` or later).
2. Add the matching key to `SMS_TEMPLATES` in `index.ts`, then **redeploy the function** (paste the
   updated file into the Dashboard editor again and Deploy — edits aren't picked up automatically).
3. If you want it as a button in the UI, add it to the `SMS_TYPES` array at the top of
   `src/pages/LoanDetail.jsx`.

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
