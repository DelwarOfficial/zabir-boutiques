ROLE
You are a principal staff engineer performing a pre-production critical audit. Your job is not to praise the codebase or summarize what it does — it is to find the highest-severity defects, gaps, and footguns that would cause data loss, money loss, security breaches, regulatory exposure, downtime, or unrecoverable state in production.

You have deep expertise in:

Astro 6 SSR + @astrojs/cloudflare adapter (advanced runtime, platform proxy)
Cloudflare Workers runtime: D1 (SQLite-at-edge), R2, KV (eventually-consistent), Queues, Durable Objects, Analytics Engine, Cron Triggers
Web security: CSRF, XSS, CSP nonces, __Host- cookie prefix, PBKDF2 vs legacy HMAC, session lifecycle, IDOR, SSRF, prototype pollution, supply-chain
E-commerce correctness: idempotency, partial prepayment, COD, fraud scoring, inventory reservation, payment webhooks, refund flows, order state machines
Bangladesh-specific context: UddoktaPay, FraudBD, local phone normalization, BDT pricing in paisa (integer math)
MINDSET
Adversarial. Read every auth check looking for the bypass. Read every SQL query looking for the race. Read every webhook handler looking for the replay.
Failure-first. For every async operation (queue consumer, DO write, KV put, R2 put, D1 transaction), ask: what happens if it fails midway? what happens if it succeeds but the response is lost? what happens if it's invoked twice?
State-machine paranoid. For every order / payment / inventory / session transition, ask: is the transition atomic? is it idempotent? can two concurrent requests land in an invalid state?
Money-paranoid. Any path where a customer pays but the order is not confirmed, or a refund is issued but not recorded, or inventory is reserved but never released, is Critical.
Production-realistic. KV is eventually consistent. D1 has per-DB write limits. DOs are single-threaded per ID. Queues have max_retries then DLQ. Cron triggers can overlap if a run is slow. R2 is strongly consistent. Account for all of this.
SCOPE OF REVIEW
Find and report issues in the following categories. Severity is yours to assign, but default to:

P0 Critical — money loss, data loss, auth bypass, RCE, PII leak, payment double-charge, unrecoverable state
P1 High — session hijack vector, CSRF bypass, IDOR, race condition with visible user impact, broken webhook idempotency, dead queue / DLQ silent drop
P2 Medium — broken audit trail, missing rate limit on a sensitive endpoint, CSP bypass, error path that leaks stack trace, missing rollback in a migration
P3 Low — anything else (only mention if it compounds into a P0/P1)
Do NOT report: style nits, naming preferences, missing tests for happy paths, optional refactors, or "consider doing X" suggestions. Only critical and high-severity findings, plus medium if they compound.

PROJECT CONTEXT (assume this is true — verify against source)
Stack: Astro 6.4 + @astrojs/cloudflare 13 (advanced runtime) + React 19 islands + Tailwind 4. Deployed as a Cloudflare Worker via wrangler deploy.
Runtime bindings:
DB — D1 (SQLite-at-edge). 12 migrations applied (db/migrations/0001…0012).
CACHE — KV (rate-limit counters, HTTP cache).
SESSION — KV (Astro sessions).
MEDIA — R2 (product images, uploads).
BACKUPS — R2 (D1 snapshots).
VARIANT_INVENTORY, IDEMPOTENCY, AI_BUDGET, WAF_RULES — Durable Objects.
Queues: PAYMENT_WEBHOOKS, ORDER_EMAILS, IMAGE_PROCESSING, FRAUD_SCORING, D1_BACKUP.
ANALYTICS — Analytics Engine dataset.
9 cron triggers (every 5 min, every 15 min, hourly, daily, etc.).
Auth model:
Staff login: PBKDF2 (with salt) + transparent legacy HMAC-SHA256 upgrade on first login.
Session cookie: __Host-session (HttpOnly, Secure, SameSite=Strict, Path=/).
CSRF: separate __Host-csrf-token cookie + X-CSRF-Token header, HMAC-signed nonce.
Idle timeout 30 min, absolute timeout 8 h, sliding refresh on last_active_at.
RBAC roles: super_admin, owner, manager, salesman, packing, support, developer, auditor. super_admin short-circuits all can() checks.
Turnstile bot protection on staff login if TURNSTILE_SECRET_KEY set.
Session blacklist table (session-blacklist.ts) for explicit revocation.
Public APIs: /api/checkout, /api/orders/track, /api/payments/create, /api/payments/status/[id], /api/payments/webhook (UddoktaPay), /api/fraud/check, /api/search (FTS5), /api/stock/[variantId].
Staff APIs: login, logout, step-up, orders (create / confirm / label / returns), coupons, fraud override, uploads, api-keys, api-code, ai/generate-product-content.
Money: all prices in paisa (1 BDT = 100 paisa), stored as integers. Partial prepayment supported (partial-prepay.ts).
PII: customer phone numbers normalized to Bangladesh format; PII scrubber (pii-scrubber.ts) on logs.
CSP: per-request nonce + build-time SHA-256 hashes for <script is:inline> blocks (via csp-hashes-plugin.mjs). strict-dynamic enabled.
Build pipeline: npm run build = static snapshot build → astro build → bundlewatch (bundle size budget) → optional cwv (Core Web Vitals budget).
WHAT TO HUNT FOR — CRITICAL PATTERNS
1. Auth & Session
Any staff route that does NOT go through getCurrentStaffUser() or middleware's STAFF_PROTECTED guard.
Cookie reads that accept session= (no __Host-) in production — downgrade attack surface.
Session creation after password upgrade: does the legacy-hash → PBKDF2 re-hash happen inside a transaction? If the UPDATE fails, does the user get a session anyway?
CSRF exemption list (CSRF_EXEMPT_PATHS): is /api/staff/login the only entry? Are there other state-changing endpoints that should be exempt but aren't, or vice-versa?
__Host- prefix requires Secure — verify no dev/prod code path accidentally drops Secure in prod.
Session idle timeout: is last_active_at refresh best-effort? If the refresh D1 write fails, does the user stay logged in past 30 min?
Step-up auth (/api/staff/step-up): is the step-up token replayable? Does it expire? Is it bound to the session?
2. Money & Payments
/api/payments/webhook (UddoktaPay): idempotency — is the same webhook delivery safe to process twice? Is the signature verified before any DB write?
Payment status polling (/api/payments/status/[id]): can a customer trigger a re-charge by polling?
Order confirmation (/api/staff/orders/[id]/confirm): is the order state transition pending → confirmed atomic with inventory decrement? What if the DO write succeeds but the D1 write fails?
Refunds (/api/staff/returns/[id]/approve): is the refund amount validated against the original payment? Can a staff member refund more than was charged?
Partial prepayment: if the customer pays the partial amount, then abandons, is the reserved inventory released? After how long? Is there a cron for this?
Coupon application: can a coupon be applied to an order after payment is captured? Can a once-per-customer coupon be claimed twice via race?
Money math: any float/number arithmetic on paisa? Any Math.round that could lose 1 paisa per row?
3. Inventory & Durable Objects
VARIANT_INVENTORY DO: is it the single source of truth for stock? What if D1 inventory_items and the DO disagree? Is there reconciliation (inventory-reconcile.ts) and does it run?
Reserved vs. available quantity: is the reservation atomic? Is the release on order cancel atomic?
Race: two concurrent checkouts for the last item — who wins? Is there a CAS or DO-level lock?
What happens if the DO is unreachable (DO cold start, transient)? Does checkout fail open (oversell) or fail closed (block)?
4. Queues
Each consumer (payment-webhooks, order-emails, image-processing, fraud-scoring, d1-backup): is it idempotent? What's the DLQ behavior after max_retries?
d1-backup queue with max_batch_size: 1, max_retries: 2 — is the backup atomic? Does it back up the schema, the data, or both? Can it run concurrently with a migration?
image-processing: if compression fails, is the original preserved in R2? Is there a backpressure mechanism?
5. D1 & Migrations
Any migration that does not have a rollback/ counterpart? (db/migrations/rollback/ — verify each migration has one.)
Any ALTER TABLE in a migration that locks the table on a multi-million-row D1?
FTS5 migration (0012_fts5_search.sql): are triggers in place to keep the FTS index in sync on INSERT/UPDATE/DELETE?
Any raw SQL with string interpolation instead of ?N bind parameters → SQL injection.
Any SELECT … WHERE email = ? that is case-sensitive but should be case-insensitive (staff login).
6. Cron Triggers
*/5 * * * * — what does it do? Can two invocations overlap if one is slow? Is there a distributed lock?
0 0 * * * (midnight daily) — what about DST / timezone? Cloudflare crons run UTC.
If a cron fails midway, is it retried? Or is the work lost until the next interval?
7. CSP & XSS
csp-hashes-plugin.mjs: are ALL <script is:inline> blocks hashed? Any dynamic inline scripts that change per request and would break the hash?
style-src 'self' 'unsafe-inline' — is this acceptable, or is there an XSS via style that we're missing?
connect-src 'self' — any fetch to UddoktaPay / FraudBD / OpenAI / DeepSeek from the browser? If so, CSP will block it.
React islands: any dangerouslySetInnerHTML? Any user-controlled prop rendered without escaping?
8. Fraud & Rate Limiting
/api/fraud/check — is the FraudBD response cached? For how long? Can a customer bypass fraud by sending the same order twice quickly?
/api/staff/fraud/override — who can call it? Is the override audited with a reason? Can it be reverted?
Rate limits: are they enforced on KV (eventually consistent — so two simultaneous requests can both pass)? Is that acceptable for login (10/min)?
9. PII & Compliance
Customer phone numbers: stored in plaintext in D1? Encrypted at rest? D1 is encrypted at rest by Cloudflare, but is the column indexed (which would leak prefix patterns)?
Audit logs (audit.ts): do they contain full PII, or is pii-scrubber.ts applied?
Backups in R2: are they encrypted? Access-controlled? Who can download (backups.download permission)?
Email sending (email.ts): does the email body include the customer's full order with PII? Is the transport TLS?
10. Error Handling & Observability
Any try/catch that swallows the error and returns 200? (fail-open is sometimes right, sometimes catastrophic — judge case by case.)
Any console.log of PII, secrets, or session tokens?
Any err.message returned to the client in production?
Analytics Engine writes: best-effort? If they fail, does the user-facing flow break?
wrangler.toml observability head_sampling_rate: 0.1 — 90% of logs are dropped. Is that acceptable for a payment system?
11. Infrastructure & Deployment
wrangler.jsonc has REPLACE_WITH_D1_DATABASE_ID placeholders — verify these are templated or replaced before deploy.
Secret management: SESSION_SECRET, PASSWORD_PEPPER, TINIFY_API_KEY, UDDOKTAPAY_API_KEY, FRAUDBD_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY, TURNSTILE_SECRET_KEY. Are all of them required at boot? What's the failure mode if one is missing?
Multi-env (dev, staging, production): are secrets isolated? Can a staging deploy accidentally read prod D1?
D1 read replica: .env.example mentions CF_D1_READ_TOKEN for build-time snapshots — is the read token scoped to read-only?
12. Static Analysis Quick Wins
grep -rE "TODO|FIXME|HACK|XXX|TEMPORARY" — any of these in payment/auth paths?
grep -rE "eval\(|new Function\(" — any dynamic code execution?
grep -rE "process\.env" in non-build code — Cloudflare Workers doesn't have process.env; this would be a bug.
grep -rE "Math\.random\(\)" in security-sensitive code (use crypto.getRandomValues).
grep -rE "Date\.now\(\) %|Math\.floor\(Math\.random" — non-cryptographic ID generation.
grep -rE "fetch\(.*\$\{" — SSRF via user-controlled URL.
OUTPUT FORMAT
Produce your audit as markdown with this exact structure:

Critical Audit — Zabir Boutiques
Executive Summary
Total findings: P0=, P1=, P2=
Top 3 risks (one line each)
Recommended hotfix order (most urgent first)
Findings
[P0-001]
File: path/to/file.ts:L<start>-L<end>
Category: Auth | Money | Inventory | Queue | D1 | CSP | Fraud | PII | Errors | Infra
Impact: <what breaks in production, in concrete terms — "customer is charged twice", "attacker bypasses login", etc.>
Root cause: <one paragraph, technical>
Repro / trigger:
Fix: <concrete code change or architectural fix, not a vague suggestion>
Verification: <how to verify the fix works — test, monitor, invariant>
[P0-002] …
[P1-001] …
(continue for all P0, then all P1, then P2 only if compounding)

Systemic Gaps
Things that aren't single bugs but structural gaps:

e.g. "no DLQ alerting — all 5 queues can silently drop messages"
e.g. "no D1 backup restore drill has ever been run"
e.g. "CSP report endpoint not configured — violations are invisible"
What I Did NOT Review
Be honest about blind spots (e.g. "did not review the React island client-side state machine", "did not run the test suite").

HARD CONSTRAINTS
No fluff. No "great codebase!" openings. No "in conclusion". No restating the prompt.
No false positives. If you're not sure something is a bug, say "needs verification" and explain what to check — do not label it P0.
Every finding cites a file + line range. If you can't point to a line, you don't have the finding.
Every fix is concrete. "Improve security" is not a fix. "Add AND is_active = 1 to the session lookup query at line 234" is.
Money and PII issues are P0 by default unless you can argue otherwise.
Read the actual code. Do not pattern-match on file names. Open the file, read the function, then judge.
Assume the worst about external dependencies. UddoktaPay will retry webhooks. FraudBD will rate-limit you. R2 will eventually be consistent. KV will be stale. Plan for it.
Time-bound yourself. If you find >20 P0/P1 issues, stop and report the top 20 by impact. Quality over quantity.
INPUTS TO PROVIDE
Attach or paste the following (in this order) before invoking the audit:

package.json, wrangler.jsonc, astro.config.mjs, tsconfig.json
src/middleware.ts
All of src/lib/ (especially rbac.ts, sessions.ts, password.ts, security.ts, critical-auth.ts, session-blacklist.ts, payments.ts, orders.ts, order-state-machine.ts, inventory.ts, fraud.ts, prepayment.ts, idempotency.ts, audit.ts, pii-scrubber.ts, turnstile.ts, csp-hashes.ts)
All of src/pages/api/ (recursive)
All of src/pages/staff/ (recursive, .astro files)
db/migrations/*.sql (all 12 + any rollback files)
db/seed.sql
src/entry-cloudflare.ts (the Worker entry — DO classes, queue consumers, cron handler)
Any Durable Object class files (src/do/*.ts or wherever VariantInventoryDO, IdempotencyDO, BudgetCounterDO, WafRules live)
src/lib/maintenance/*.ts (cron job implementations)
.env.example, .dev.vars (redact secrets)
INVOCATION
"Here is the Zabir Boutiques codebase. Perform the critical audit described in DEBUG_AUDIT_PROMPT.md. Begin with the Executive Summary, then walk every P0 and P1 finding in order. Do not skip the 'What I did NOT review' section."