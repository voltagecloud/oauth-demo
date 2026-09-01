# Rate limiting deposits by OAuth identity

How to build "each customer may deposit at most N times, or M in value, per day"
on the Voltage Payments API.

Language agnostic: every call is a `curl`, every decision is pseudocode. This
repo is one implementation of it; nothing here depends on that implementation.

---

## The idea in one page

You want a limit that follows a **person**, not a browser, an IP or a session.
That needs two things: a durable identity, and a count of what that identity has
already done today.

1. **Identity** comes from Google OAuth. After sign-in you hold the user's Google
   `sub` — a stable, opaque id for that account. Call it `google:<sub>`.

2. **The count comes from Voltage.** Every invoice you create can carry arbitrary
   `metadata`, and `GET /payments` can filter on it. So tag each invoice with the
   user's id, and "what has this person deposited today?" becomes one API call.

That second point is the whole trick, and it is worth being explicit about what it
saves you: **you do not need a database.** No table of customer payments, no
nightly reconciliation, no second source of truth that can drift away from where
the money actually is. Voltage already knows every payment; you are just asking it
a question with a filter attached.

```
                                          ┌─────────────────────────────┐
  1. user signs in with Google            │ Voltage Payments API        │
     └─► you hold google:<sub>            │                             │
                                          │                             │
  2. read the ledger  ────────────────────┼─► GET /payments             │
     GET /payments?metadata[player_id]=…  │      ?metadata[…]           │
     ◄── every deposit this person made   │      &start_date=…          │
         since 00:00 UTC                  │                             │
                                          │                             │
  3. you decide  (count? total?)          │   ← this part is yours      │
     over the limit → stop here           │                             │
                                          │                             │
  4. mint the invoice ────────────────────┼─► POST /payments            │
     with metadata.player_id set          │      metadata: {player_id}  │
     ◄── bolt11 to show the user          │                             │
                                          │                             │
  5. poll until paid  ────────────────────┼─► GET /payments/{id}        │
                                          └─────────────────────────────┘
```

Step 4's metadata is what makes step 2 possible on the *next* deposit. If you
forget it, the invoice is invisible to your own limit.

### Who enforces what

Voltage has wallet policies of its own. They are not a substitute for the above,
and knowing the difference saves an afternoon:

| Limit | Enforced by | Scope |
| --- | --- | --- |
| Max size of a single payment | **Voltage** | The wallet — everyone |
| Transactions per minute | **Voltage** | The wallet — everyone |
| Deposits per customer per day | **You** | One identity |
| Value per customer per day | **You** | One identity |

Voltage has no concept of *your* customers. It secures the wallet; anything
per-person is yours to build. That is what this document is about.

---

## Before you start

You need four things. Steps 1–3 below get them.

- A Voltage organization, environment, wallet, and API key
- Rate limiting enabled on your organization *(closed beta — see step 1)*
- A Google OAuth client id and secret
- Somewhere to run server-side code that can hold a secret

> **The API key is a server-side secret.** It can move money. It must never reach
> a browser, a mobile app, or a public repository. Every `curl` in this document
> is something your backend does, never your frontend.

---

## Step 1 — Voltage setup

### 1a. Create the organization, environment and wallet

In the [Voltage dashboard](https://voltage.cloud):

1. Create an **organization** if you do not have one. Note its UUID.
2. Create an **environment** inside it (this is the boundary an API key is scoped
   to — typically one per deployment stage). Note its UUID.
3. Create a **wallet** in that environment to receive deposits. Note its UUID.

A wallet is denominated by its **line of credit**, in either bitcoin or USD. You
do not choose this per-invoice; it follows the wallet. It changes what your API
calls look like, so find out which you have — step 1d shows you how.

### 1b. Create an API key

In the environment's settings, create an API key with **WRITE** access.

> The secret is shown once. Store it in a secret manager. If you lose it, rotate
> rather than hunt for it.

### 1c. Ask Voltage to enable rate limiting

Rate limiting is currently a **closed beta** and is not enabled by default.
Contact Voltage and ask for it to be turned on for your organization before you
build against it.

<!-- TODO(voltage): replace with the exact feature name and the request channel
     — support email, dashboard toggle, or account contact. -->

### 1d. Check your credentials, and find your wallet's currency

Set these once; the rest of the document reuses them.

```bash
export VOLTAGE_API_URL="https://voltageapi.com/v1"
export VOLTAGE_API_KEY="…"
export ORGANIZATION_ID="…"
export ENVIRONMENT_ID="…"
export WALLET_ID="…"
```

Read the wallet back:

```bash
curl --fail-with-body -s \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/wallets/$WALLET_ID"
```

```jsonc
{
  "id": "…",
  "name": "deposits",
  "network": "mutinynet",                 // mainnet | testnet | signet | mutinynet
  "line_of_credit_id": "951b6d9a-…",      // ← ask this for the currency
  "balances": []                          // ← EMPTY on a new wallet. Do not read this.
}
```

Then ask the line of credit what currency it is:

```bash
export LINE_OF_CREDIT_ID="951b6d9a-…"

curl --fail-with-body -s \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/lines_of_credit/$LINE_OF_CREDIT_ID/summary"
```

```jsonc
{ "id": "951b6d9a-…", "currency": "usd", "network": "mutinynet", "limit": 50000000 }
```

> **Read the currency from the line of credit, not from `wallet.balances`.**
> A balance only appears once money has moved through the wallet, so a new wallet
> reports `"balances": []` and tells you nothing. The line of credit has a
> currency from the moment it exists.

**Two traps worth knowing now:**

- **An API key is bound to the host that issued it.** Presenting one to a
  different host fails with `missing_credentials` (HTTP 400), not `401` — which
  reads like the header is missing rather than mismatched. If Voltage gave you a
  base URL other than the default, use that one throughout.
- Wallet-scoped endpoints are addressed by **organization + wallet**, not by
  environment. Payment endpoints are environment-scoped. They differ.

### 1e. Units

Every amount in the API is in the currency's **smallest unit**:

| Currency | Unit | `10000` means |
| --- | --- | --- |
| `btc` | millisatoshis | 10 sats |
| `usd` | cents | $100.00 |

Use the same unit throughout your own code — configuration, counters, limits —
and convert only when rendering. Mixing units is the single easiest way to get a
limit that is wrong by a factor of a thousand without anything erroring.

---

## Step 2 — Google OAuth setup

Go to **[console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients)**
(Google Auth Platform → Clients). Select or create a project.

1. If prompted, register the app first — this is the consent screen. An app name,
   a support email and a developer contact are all you need.
2. **Create client** → application type **Web application**.
3. Under **Authorized redirect URIs**, add one entry per origin you will run on:
   ```
   http://localhost:8888/auth/google/callback
   https://your-app.example.com/auth/google/callback
   ```
4. **Create.** Copy the client id and secret — the secret is shown once.

**Authorized JavaScript origins can be left empty.** That field is for
browser-side flows; you are doing the code exchange on your server.

```bash
export GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="…"
export REDIRECT_URI="https://your-app.example.com/auth/google/callback"
```

**Three things that will bite you:**

- The redirect URI must match **byte for byte** — scheme, case and trailing slash
  included. `http` vs `https` and a stray `/` are the classic failures.
- Under **Audience**, a new external app starts in *Testing*, where only accounts
  you explicitly add as test users can sign in — everyone else sees an
  access-denied screen that looks like your app is broken. Since this flow only
  requests `openid email profile` — all non-sensitive scopes — you can publish to
  production **without** Google's app verification.
- Edits can take several minutes to propagate. If a redirect fails immediately
  after you add a URI, wait before assuming it is wrong.

---

## Step 3 — Implement the OAuth flow

You need OAuth for exactly one thing: to end up holding a verified Google `sub`.
Everything after that is your own session handling.

Use the **authorization code flow with PKCE**. Three moves.

### 3a. Send the user to Google

Generate a PKCE pair and a `state` value, store both server-side against the
pending sign-in, then redirect the browser to:

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=<GOOGLE_CLIENT_ID>
  &redirect_uri=<REDIRECT_URI>
  &response_type=code
  &scope=openid%20email%20profile
  &state=<opaque random value>
  &code_challenge=<BASE64URL(SHA256(verifier))>
  &code_challenge_method=S256
  &prompt=select_account
```

PKCE, in two lines of any language:

```
verifier  = base64url(32 random bytes)
challenge = base64url(sha256(verifier))
```

`state` must be unguessable and must be checked on the way back — that is what
stops someone else's callback being replayed at your endpoint. `prompt=select_account`
is optional but worth it: a demo gets shown repeatedly, often by someone who wants
to switch accounts to prove the limit really is per-person.

### 3b. Exchange the code

Google redirects to `REDIRECT_URI?code=…&state=…`. Verify `state` matches a
pending sign-in you created, then:

```bash
curl --fail-with-body -s -X POST \
  -H "content-type: application/x-www-form-urlencoded" \
  -d "code=$CODE" \
  -d "client_id=$GOOGLE_CLIENT_ID" \
  -d "client_secret=$GOOGLE_CLIENT_SECRET" \
  -d "redirect_uri=$REDIRECT_URI" \
  -d "grant_type=authorization_code" \
  -d "code_verifier=$VERIFIER" \
  "https://oauth2.googleapis.com/token"
```

```jsonc
{ "access_token": "…", "expires_in": 3599, "id_token": "eyJhbGciOi…", "token_type": "Bearer" }
```

### 3c. Read the identity out of the `id_token`

The `id_token` is a JWT: three base64url segments separated by dots. Decode the
middle one.

```bash
echo "$ID_TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

```jsonc
{
  "iss": "https://accounts.google.com",
  "aud": "…apps.googleusercontent.com",
  "sub": "107422241192060178656",        // ← this is the user. Stable forever.
  "email": "player@example.com",
  "email_verified": true,
  "exp": 1788888888
}
```

Check before you trust it:

- `iss` is `https://accounts.google.com` or `accounts.google.com`
- `aud` equals your client id
- `exp` is in the future

> **On signature verification.** You may skip it *here*, because this token came
> straight from Google's token endpoint over TLS in direct response to your own
> code exchange — OpenID Connect explicitly permits that for a confidential
> client. If you ever accept an `id_token` from anywhere else — a client POST, a
> URL fragment, a mobile app — you must verify the signature against Google's
> JWKS. The distinction is where the token came from, not what it contains.

**`sub` is the identity.** Not the email: emails can change, and on Workspace
accounts they can be reassigned to a different human. Key your limits on `sub`.

### 3d. Hold on to it

Put the user in your own session — a signed cookie is enough; this flow needs no
database. From here on, one value matters:

```
player_id = "google:" + sub        e.g. "google:107422241192060178656"
```

The `google:` prefix costs nothing now and means a second identity provider later
cannot collide with an existing id.

---

## Step 4 — Read the ledger

This is the call that replaces your database. Ask Voltage what this person has
deposited in the current window.

```bash
export PLAYER_ID="google:107422241192060178656"
export WINDOW_START="2026-09-01T00:00:00Z"   # 00:00 UTC today

curl --fail-with-body -s -G \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/environments/$ENVIRONMENT_ID/payments" \
  --data-urlencode "metadata[app]=my-app" \
  --data-urlencode "metadata[player_id]=$PLAYER_ID" \
  --data-urlencode "direction=receive" \
  --data-urlencode "start_date=$WINDOW_START" \
  --data-urlencode "statuses[]=completed" \
  --data-urlencode "statuses[]=receiving" \
  --data-urlencode "statuses[]=generating" \
  --data-urlencode "pagination=cursor" \
  --data-urlencode "limit=100"
```

What each filter is doing:

| Parameter | Why |
| --- | --- |
| `metadata[player_id]` | The whole point. Only this person's deposits. |
| `metadata[app]` | Scopes to your app, so one environment can host several. |
| `direction=receive` | Deposits only, not payouts. |
| `start_date` | The window. Use 00:00 UTC for a daily reset. |
| `statuses[]` | Only what should count — see below. |
| `pagination=cursor` | `offset` is deprecated. Follow `next_cursor`. |

```jsonc
{
  "items": [
    {
      "id": "…",
      "direction": "receive",
      "status": "completed",
      "metadata": { "app": "my-app", "player_id": "google:1074…" },
      "requested_amount": { "currency": "usd", "amount": 1000, "unit": "cents" },
      "data": { "amount": { "currency": "usd", "amount": 1000 }, "payment_request": "lntbs…" },
      "created_at": "2026-09-01T15:20:00Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

Follow `next_cursor` until `has_more` is false, repeating the **same filters and
sort** — the cursor is bound to them.

### Which statuses count

| Status | Meaning | Count it? |
| --- | --- | --- |
| `generating` | Invoice being created | **Yes** — reserved |
| `receiving` | Invoice live, awaiting payment | **Yes** — reserved |
| `completed` | Paid | **Yes** |
| `expired` | Lapsed unpaid | No |
| `failed` | Never worked | No |

**Count unpaid invoices against the limit.** If you only count `completed`, a user
can request five invoices in parallel — each checked against a total that none of
them has moved yet — and then pay all five, sailing past the cap. Treating live
invoices as reservations closes that.

The cost is that an abandoned invoice ties up allowance until it expires, so keep
`expiration` short (15 minutes is reasonable) and give users a way back to an
unpaid invoice rather than stranding it.

---

## Step 5 — Decide

Pure local logic. No API involved.

```
used    = { count: 0, amount: 0 }     # completed
pending = { count: 0, amount: 0 }     # generating + receiving

for payment in items:
    bucket = used if payment.status == "completed" else pending
    bucket.count  += 1
    bucket.amount += amount_of(payment)      # see below

total_count  = used.count  + pending.count
total_amount = used.amount + pending.amount

if total_count + 1 > MAX_DEPOSITS_PER_DAY:
    deny("quantity", used: total_count, limit: MAX_DEPOSITS_PER_DAY)

if total_amount + requested > MAX_AMOUNT_PER_DAY:
    deny("amount", used: total_amount, limit: MAX_AMOUNT_PER_DAY)

allow()
```

### Reading `amount_of(payment)`

Match on the currency you are counting in and take the field that agrees:

```
for candidate in [payment.data.amount, payment.requested_amount]:
    if candidate.currency == your_wallet_currency:
        return candidate.amount
```

> **On a USD wallet, do not assume `requested_amount` is bitcoin.** On a
> cross-currency payment these fields report the *display* currency — cents on a
> USD wallet. Take whichever field matches the currency you are counting in.

### On denials

Answer **`429 Too Many Requests`** with a `Retry-After` header pointing at the
reset. It is the correct status for a rate limit, clients already understand it,
and it avoids `403`/`404`, which some CDNs and proxies retry as static-file
lookups.

Return enough for an honest message — which limit fired, used, the limit, and when
it resets:

```jsonc
{
  "error": {
    "code": "policy_denied",
    "message": "Daily deposit limit reached — 3 of 3 used.",
    "denial": { "kind": "quantity", "used": 3, "limit": 3, "resets_at": "2026-09-02T00:00:00Z" }
  }
}
```

**Check before you mint.** Read, decide, *then* create the invoice. Creating it
first means a denied request has already spent the allowance it was denied for.

---

## Step 6 — Mint the invoice

**You generate the `id`.** It is a UUID you choose, and Voltage treats it as the
idempotency key — a retry with the same id will not create a second invoice. Keep
it; you will poll on it.

Every mutating call answers **`202 Accepted` with an empty body** and does the work
asynchronously. Nothing here returns an invoice directly.

### On a bitcoin wallet

```bash
export PAYMENT_ID="$(uuidgen | tr 'A-Z' 'a-z')"

curl --fail-with-body -s -X POST \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  -H "content-type: application/json" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/environments/$ENVIRONMENT_ID/payments" \
  --data @- <<JSON
{
  "id": "$PAYMENT_ID",
  "wallet_id": "$WALLET_ID",
  "payment_kind": "bolt11",
  "amount": { "currency": "btc", "amount": 1000000 },
  "description": "Deposit",
  "expiration": 900,
  "metadata": {
    "app": "my-app",
    "player_id": "$PLAYER_ID"
  }
}
JSON
```

**`metadata.player_id` is the load-bearing line.** Without it this invoice is
invisible to step 4 and does not count against anything.

Metadata limits: up to 50 entries, keys and values 256 characters each, string
values only.

### On a USD wallet — quote first

A USD wallet cannot price an invoice on its own, because bitcoin is what moves
over Lightning. You must lock a rate first; `POST /payments` **rejects a USD
receive without a `quote_id`**.

**1. Request the quote** (USD → BTC, because the customer-facing amount is in USD):

```bash
export QUOTE_ID="$(uuidgen | tr 'A-Z' 'a-z')"

curl --fail-with-body -s -X POST \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  -H "content-type: application/json" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/environments/$ENVIRONMENT_ID/quotes" \
  --data @- <<JSON
{
  "id": "$QUOTE_ID",
  "line_of_credit_id": "$LINE_OF_CREDIT_ID",
  "network": "mutinynet",
  "amount": { "currency": "usd", "amount": 1000 },
  "to": "btc"
}
JSON
```

**2. Poll until it is usable:**

```bash
curl --fail-with-body -s \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/environments/$ENVIRONMENT_ID/quotes/$QUOTE_ID"
```

Proceed only when **all** of these hold:

```
quote        is not null
created_at   is not null
consumed_at  is null
failed_at    is null   and   error is null
expires_at   is in the future
```

**3. Create the receive, same USD amount, with the quote attached:**

```bash
curl --fail-with-body -s -X POST \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  -H "content-type: application/json" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/environments/$ENVIRONMENT_ID/payments" \
  --data @- <<JSON
{
  "id": "$PAYMENT_ID",
  "wallet_id": "$WALLET_ID",
  "quote_id": "$QUOTE_ID",
  "payment_kind": "bolt11",
  "amount": { "currency": "usd", "amount": 1000 },
  "description": "Deposit \$10.00",
  "expiration": 900,
  "metadata": { "app": "my-app", "player_id": "$PLAYER_ID" }
}
JSON
```

Quotes are **single-use and short-lived**: mint one per deposit, and cap the
invoice `expiration` at the quote's remaining life, since the invoice cannot
outlive the rate it was priced at.

---

## Step 7 — Poll for the invoice, then for payment

```bash
curl --fail-with-body -s \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/environments/$ENVIRONMENT_ID/payments/$PAYMENT_ID"
```

```jsonc
{
  "id": "…",
  "status": "receiving",
  "data": {
    "payment_request": "lntbs1500n1pn…",   // ← the bolt11. Show this as a QR.
    "amount": { "currency": "usd", "amount": 1000 }
  }
}
```

The lifecycle is `generating → receiving → completed | expired | failed`. Poll
every 1–2 seconds until terminal.

> **A `GET` right after a successful `POST` can legitimately return `404`.** Reads
> and writes are eventually consistent. Treat an early `404` as "not ready yet"
> and retry with backoff — not as "gone".

**Do not block a request handler waiting for settlement.** Return the payment id
and let the client poll your own endpoint. A user can take minutes to pay; no
serverless function should be alive that long.

When `status` becomes `completed`, credit the user. The next call to step 4 will
include this payment automatically — there is nothing for you to write down.

---

## Optional: Voltage's own wallet policies

Worth setting as a backstop. These are wallet-wide and apply to everyone, so they
complement your per-identity limits rather than replacing them.

```bash
curl --fail-with-body -s -X PATCH \
  -H "x-api-key: $VOLTAGE_API_KEY" \
  -H "content-type: application/json" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/wallets/$WALLET_ID/policies" \
  --data '{ "max_payment_size_sats": 5000000, "transactions_per_minute": 100 }'
```

Note the path: **organization + wallet**, not environment. `GET` the same path to
read them back; `PATCH` answers `202` and applies asynchronously.

---

## Optional: paying an invoice from another wallet

Useful for testing without a Lightning wallet on hand. Two wallets in the same
environment settle against each other without touching the network.

**From a bitcoin wallet** — straightforward:

```bash
curl --fail-with-body -s -X POST \
  -H "x-api-key: $VOLTAGE_API_KEY" -H "content-type: application/json" \
  "$VOLTAGE_API_URL/organizations/$ORGANIZATION_ID/environments/$ENVIRONMENT_ID/payments" \
  --data @- <<JSON
{
  "id": "$(uuidgen | tr 'A-Z' 'a-z')",
  "wallet_id": "$TREASURY_WALLET_ID",
  "currency": "btc",
  "type": "bolt11",
  "data": {
    "payment_request": "$BOLT11",
    "max_fee": { "currency": "btc", "amount": 1000 }
  }
}
JSON
```

**From a USD wallet** — needs its own quote, in the other direction (BTC → USD),
because bitcoin is what leaves the wallet and the dollar cost must be fixed first.

The BTC amount comes from **decoding the bolt11 itself**, not from the payment
record: on a USD wallet the record reports cents, so there is no bitcoin figure in
it to read. Any BOLT-11 decoder library will give you the millisatoshi value.

```bash
# 1. quote the invoice's BTC amount to USD
#    { "id": …, "line_of_credit_id": …, "network": …,
#      "amount": { "currency": "btc", "amount": 150000 }, "to": "usd" }
# 2. poll it usable, as in step 6
# 3. send, with currency "usd" and the rail amount still in BTC:
{
  "id": "…",
  "wallet_id": "$TREASURY_WALLET_ID",
  "quote_id": "$QUOTE_ID",
  "currency": "usd",
  "type": "bolt11",
  "data": {
    "payment_request": "$BOLT11",
    "amount":  { "currency": "btc", "amount": 150000 },
    "max_fee": { "currency": "btc", "amount": 1000 }
  }
}
```

The rail amount stays in BTC throughout so Voltage can check the quote and the
payment match exactly.

> Gate this endpoint hard. Require a session, and verify against the metadata
> **Voltage holds** — never against anything the caller sent — that the invoice
> belongs to the caller. An open "spend from the treasury" route is a bad thing to
> publish, test funds or not.

---

## Optional: signing in on a second device

To let someone scan a QR on their phone and end up signed in on their laptop, you
do not need a websocket.

1. The laptop asks your backend for a **handoff id** — 256 bits of randomness,
   five-minute expiry, single use. Show its URL as a QR code.
2. The phone opens that URL and completes the Google flow, passing the handoff id
   as the OAuth `state`. Your callback writes the verified identity into the
   handoff record.
3. The laptop **polls** your backend for that handoff id. The first poll that
   finds it approved consumes the record and returns the session cookie.

The poll response *is* the sign-in. Consume the record with a compare-and-set so a
replayed poll cannot mint a second session, and treat the handoff id as a bearer
token, because that is exactly what it is.

---

## Things that will bite you

| Symptom | Cause |
| --- | --- |
| `missing_credentials` (400), not 401 | The key belongs to a different host than the one you called. Match the key to its base URL. |
| Limit is wrong by ~1000× | Mixed units. Cents and msats are both "10000" and neither errors. |
| Amounts count wrong on a USD wallet | Read the field whose `currency` matches; do not assume `requested_amount` is bitcoin. |
| `GET` 404s right after `POST` | Eventual consistency. Retry with backoff. |
| USD invoice rejected | Missing `quote_id`. USD receives must be quoted. |
| Currency detected wrong on a new wallet | `wallet.balances` is `[]` until money moves. Read the line of credit. |
| Limits look right but count nothing | `metadata` missing at creation — the invoice is invisible to the filter. |
| Users locked out with allowance spent | Unpaid invoices reserved and stranded. Keep expiry short; let users resume them. |
| Google returns access denied | App still in *Testing*; the account is not a listed test user. |
| Denial response mangled to 405 | A proxy retrying 403/404 as a static file. Use 429. |

---

## Reference

| | |
| --- | --- |
| Base URL | `https://voltageapi.com/v1` |
| Auth header | `x-api-key: <key>` |
| API reference | <https://voltageapi.com/v1/docs> |
| OpenAPI spec | <https://voltageapi.com/v1/openapi/docs.json> |
| Guides | <https://docs.voltageapi.com> |

Endpoints used here, all prefixed with the base URL:

```
GET   /organizations/{org}/wallets/{wallet}
GET   /organizations/{org}/lines_of_credit/{line}/summary
GET   /organizations/{org}/wallets/{wallet}/policies
PATCH /organizations/{org}/wallets/{wallet}/policies

GET   /organizations/{org}/environments/{env}/payments          ← the ledger read
POST  /organizations/{org}/environments/{env}/payments          ← mint / send
GET   /organizations/{org}/environments/{env}/payments/{id}
POST  /organizations/{org}/environments/{env}/quotes            ← USD only
GET   /organizations/{org}/environments/{env}/quotes/{id}
```

A complete working implementation of everything above is in this repository — see
[`README.md`](../README.md) for its architecture, and `lib/limits.ts` for the
policy engine in about 120 lines.
