# Jungle Jackpot

A demo casino that makes you sign in with Google before you can deposit, then holds
you to a daily deposit limit — **built entirely on the Voltage Payments API, with no
hosted checkout widget.**

Every Voltage call is visible on screen while you use it.

```
Browser (laptop)              Next.js on Netlify              Voltage Payments API
  │                             │                                │
  │  POST /api/link             │                                │
  │◄─ handoff id + QR ──────────┤  Netlify Blobs                 │
  │                             │                                │
  │  [phone scans the QR]       │                                │
  │      └─► /link/{id} ────────┤  Google OAuth (code + PKCE)    │
  │                             │  state = handoff id            │
  │                             │                                │
  │  GET /api/link/{id} (poll)  │                                │
  │◄─ Set-Cookie: session ──────┤  signed cookie, no store       │
  │                             │                                │
  │  POST /api/deposits ────────┤ 1. read the ledger ───────────►│ GET  /payments
  │                             │ 2. apply the daily caps        │
  │                             │ 3. mint the invoice ──────────►│ POST /payments
  │◄─ payment id ───────────────┤                                │      (202, empty)
  │                             │                                │
  │  GET /api/deposits/{id} ────┼───────────────────────────────►│ GET  /payments/{id}
  │◄─ bolt11 + status (poll)    │                                │
```

## Why this exists

There is already a demo of this flow — `casino-checkout-oauth` — but it runs on Voltage's
hosted checkout. The merchant app is 169 lines that create an "intent" and poll it; the
Google exchange, the identity-to-policy binding, the daily counters and the invoice UI all
live inside Voltage's own app, behind a `checkout_url`.

That hides exactly the parts an integrator needs to see. If you are going to call the API
from your own backend and build your own frontend, a URL that does it all for you is not a
reference. So this rebuild owns all of it: the OAuth flow, the policy engine, the invoice,
the QR, the polling.

## USD wallets need a quote

Bitcoin is what actually moves over Lightning, so a USD-denominated wallet cannot
put an amount in a bolt11 on its own — it needs a locked exchange rate first.
`POST /payments` **rejects a USD receive without a `quote_id`**, which makes this a
three-step flow rather than one call:

```
POST /quotes                     { amount: {currency:"usd", amount:1000}, to:"btc",
                                   line_of_credit_id, network }   -> 202
GET  /quotes/{id}   (poll)       until `quote` and `created_at` are set, and it is
                                 unconsumed, unexpired, and not failed
POST /payments                   { quote_id, amount: {currency:"usd", amount:1000},
                                   payment_kind:"bolt11" }        -> 202
```

Quotes are single-use and short-lived, so one is minted per deposit and the invoice
expiry is capped to the quote's remaining life. See `lib/voltage/quotes.ts`.

**Sends need quoting too.** Paying an invoice *from* a USD wallet — which is what the
autopay helper does — needs its own BTC→USD quote, because bitcoin is what leaves the
wallet and the dollar cost has to be fixed first. The rail amount stays in BTC
throughout so Voltage can check the quote and the payment agree exactly. The treasury
wallet is profiled separately from the deposit wallet, since the two can be
denominated differently and it is the *paying* wallet's currency that decides.

**The accounting trap.** On a quoted receive, `requested_amount` is the converted
**bitcoin rail** amount, while `data.amount` carries the USD cents the customer was
actually asked for. Summing the wrong one compares msats against a dollar cap and
produces a plausible, entirely wrong number — so `paymentAmount()` matches on
currency and takes the field that agrees.

None of this applies to a bitcoin wallet: the quote step is skipped and the invoice
is minted directly.

**You do not configure any of it.** `GET /wallets/{id}` gives the network and the
line of credit, and `GET /lines_of_credit/{id}/summary` gives the currency — so the
app asks rather than making you restate it (`lib/wallet-profile.ts`, cached for five
minutes). `VOLTAGE_CURRENCY`, `VOLTAGE_NETWORK` and `VOLTAGE_LINE_OF_CREDIT_ID`
remain as overrides for a key that cannot read wallets.

The currency comes from the **line of credit**, not the wallet's `balances` array.
A line of credit carries a required `currency` from the moment it exists; `balances`
is `[]` until money has actually moved through the wallet — which is precisely the
state a freshly created demo wallet is in. Balances are only a fallback, for a wallet
with no line of credit at all.

That is not just convenience. A currency the operator has to restate is a currency
they can get wrong, and getting it wrong is silent: a USD wallet read as bitcoin
renders $100.00 as "10 sats" and skips the quote its invoices depend on. The policy
panel now shows the detected currency and whether it was detected or overridden.

## Units

Every amount in this app — configuration, ledger, caps — is in the wallet
currency's **base unit**, exactly as the Voltage API takes and returns it:

| Wallet currency | Base unit | `LIMIT_AMOUNT_PER_DAY=10000` means |
| --- | --- | --- |
| USD | cents | $100.00 |
| BTC | msats | 10 sats |

One unit all the way through is what stops a dollar cap being compared against a
bitcoin rail amount. Conversion happens once, at the edge, for display
(`lib/money.ts`).

## The idea worth stealing: Voltage is the ledger

Rate limiting per customer normally means a database — the reference implementation uses a
SQLite table of `customer_payments` and sums it per UTC day.

You don't need one. Voltage receive payments accept arbitrary `metadata`, and `GET
/payments` filters on it. So tag every invoice with the player's Google subject:

```jsonc
// POST /organizations/{org}/environments/{env}/payments
{
  "id": "9c3f1a80-…",              // you generate it; it is also the idempotency key
  "wallet_id": "7a68a525-…",
  "payment_kind": "bolt11",
  "amount": { "currency": "btc", "amount": 500000 },   // msats
  "metadata": {
    "app": "jungle-jackpot",
    "player_id": "google:1080000000000000000"
  }
}
```

…and today's usage becomes one query:

```
GET /organizations/{org}/environments/{env}/payments
  ?direction=receive
  &metadata[app]=jungle-jackpot
  &metadata[player_id]=google:1080000000000000000
  &start_date=2026-09-01T00:00:00Z
  &statuses[]=completed&statuses[]=receiving&statuses[]=generating
  &pagination=cursor&limit=100
```

Count the rows and sum the amounts and you have the player's standing. No database, nothing
to keep in step with the money, and it survives a redeploy. See `lib/limits.ts`.

**In-flight invoices count too.** `receiving` and `generating` payments are held as
reservations, not ignored. Counting only settled payments — which is what the reference
does — lets someone mint five invoices in parallel and pay them all at once, overshooting
the cap they were checked against.

## Two policy layers, and only one is yours

The demo shows both side by side, because the distinction catches people out:

| | Enforced by | Scope | Where |
| --- | --- | --- | --- |
| Max size of any single payment | **Voltage** | The wallet, everyone | `GET /organizations/{org}/wallets/{id}/policies` |
| Transactions per minute | **Voltage** | The wallet, everyone | same |
| Deposits per day | **You** | One Google account | `lib/limits.ts` |
| Sats per day | **You** | One Google account | `lib/limits.ts` |

Voltage's wallet policies (`max_payment_size_sats`, `transactions_per_minute`,
`send_volume_limit_sats`) are real and worth setting, but they are wallet-level brakes.
Voltage has no concept of *your customers*, so anything per-identity is yours to build.

Note that the policies endpoint is addressed by organization **and wallet** — unlike the
payments endpoints it is not environment-scoped. Easy to get wrong.

## Signing in on a different device

The laptop opens a handoff record, encodes its URL in a QR code, and polls. The phone scans
it, completes Google's flow, and writes the identity into that record. The laptop's next
poll reads it — **and that poll's response is what carries the session cookie**. No
websocket, no server-sent events, no pairing protocol.

The handoff id is the only thing protecting the session, so it is 256 bits of randomness,
expires in five minutes, and is consumed exactly once via a Netlify Blobs compare-and-set.
It doubles as the OAuth `state`: a callback whose state doesn't resolve to a live record
this server minted is rejected.

Clicking "continue in this browser" takes the same path — it just skips the phone.

## Everything is 202-and-poll

Every mutating Voltage call answers `202 Accepted` with an empty body and does the work
asynchronously. Idempotency comes from a UUID *you* generate, not a header. Reads are
eventually consistent, so a `GET` issued right after a successful write can legitimately
404 for a moment.

So no request handler here blocks waiting for a payment to settle. `POST /api/deposits`
returns a payment id and the browser polls `/api/deposits/{id}`, which keeps every handler
well inside the serverless execution ceiling and gives the UI honest intermediate states.

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill it in
```

**Voltage.** From the dashboard, in the environment holding your line of credit: create an
API key with WRITE access and note the organization, environment and wallet ids. Fill in
`VOLTAGE_API_KEY`, `VOLTAGE_ORGANIZATION_ID`, `VOLTAGE_ENVIRONMENT_ID` and
`VOLTAGE_WALLET_ID`.

A staging key does **not** authenticate against production — it answers
`missing_credentials`, not `401`. If your key is staging's, set
`VOLTAGE_API_BASE=https://staging.voltageapi.com/v1`.

**Google.** Create a Web application OAuth client at
[console.cloud.google.com](https://console.cloud.google.com/apis/credentials) and add an
authorized redirect URI for every origin you run on:

```
http://localhost:8888/api/auth/google/callback
https://<your-site>.netlify.app/api/auth/google/callback
```

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_SECRET`
(`openssl rand -base64 32`).

**Limits.** `LIMIT_DEPOSITS_PER_DAY` and `LIMIT_AMOUNT_PER_DAY` are the whole point —
turn them down to something small to watch the denial fire. Neither has a default:
the app refuses to serve rather than invent a number, because a default standing in
for missing configuration looks exactly like a real policy on screen.

**USD wallets** need no extra configuration — the currency, network and line of
credit are read from the wallet. The API key does need wallet read access for that;
without it, set `VOLTAGE_CURRENCY` (and `VOLTAGE_LINE_OF_CREDIT_ID` for USD) by hand.

## Running it

```bash
pnpm dev          # netlify dev on http://localhost:8888
```

Use `netlify dev`, not `next dev`: Netlify Blobs needs the sandbox the CLI provides, so the
cross-device handoff fails under a bare `next dev`.

```bash
pnpm typecheck
pnpm lint
pnpm build
```

To test the QR properly you need a phone on the same page, which means a secure context —
`localhost` counts for the laptop, but a phone camera pointed at a LAN address does not.
Test cross-device sign-in on a deploy preview.

If you don't have a wallet that speaks your test network, set
`VOLTAGE_TREASURY_WALLET_ID` to a funded wallet in the *same* environment and a **Pay from
treasury** button appears on the invoice. Both wallets sit in one environment, so the
payment short-circuits instead of touching the Lightning Network. That route requires a
signed-in session, verifies against the metadata Voltage holds that the invoice is the
caller's own, and only ever pays an invoice that already passed the daily caps.

## Deploying

Netlify auto-detects Next.js and installs `@netlify/plugin-nextjs`; `netlify.toml` only
pins the Node version and tells `netlify dev` what to run. Set every variable from
`.env.example` in the site's environment, and make sure the Google client has a redirect
URI matching the deployed origin.

## Layout

| Path | What's there |
| --- | --- |
| `lib/voltage/` | API client, payments, quotes, wallet policies, a hand-written schema subset |
| `lib/money.ts` | Base units, currency-aware formatting, default presets |
| `lib/wallet-profile.ts` | Reads the wallet's currency, network and line of credit |
| `lib/limits.ts` | The policy engine — reads the ledger, decides, explains itself |
| `lib/google.ts` | OAuth: authorize URL, PKCE, code exchange, id_token claims |
| `lib/handoff.ts` | Cross-device sign-in records in Netlify Blobs |
| `lib/session.ts` | HMAC-signed session cookie. There is no session store |
| `lib/trace.ts` | Records every Voltage call for the on-screen debug menu |
| `app/api/` | Route handlers |
| `components/` | The machine, the cashier, the debug menu |

## Known limitations

- The game is decorative. Credits are local state and no payout is real; the only money
  that moves is the deposit. One credit is one base unit, so $5.00 buys 500 credits.
- Limits are keyed on the Google subject, so a second Google account is a second allowance.
  That is the honest bound of "sign in to prove you're a person" and worth being clear
  about — it is a rate limit, not an identity check.
- No webhooks. The UI learns everything by polling, which is the simplest thing that works
  and keeps the debug menu readable. `POST /webhooks` exists if you want push.
- `netlify dev` retries `403` and `404` responses as static-file lookups
  (`/deposits/{id}` → `/deposits/{id}.html`). Payment ids are validated as UUIDs so that
  retry can never resolve to a different record — but it is why a cross-player read shows
  as `400` through `:8888` and a clean `404` straight from Next.

## Reference

- API docs: <https://docs.voltageapi.com>
- OpenAPI spec: <https://voltageapi.com/v1/openapi/docs.json>
- Base URL: `https://voltageapi.com/v1` (staging: `https://staging.voltageapi.com/v1`)
- USD receive workflow: <https://docs.voltageapi.com/receiving>
- Auth: `x-api-key: <key>`

Test sats are worth nothing. Play responsibly.
