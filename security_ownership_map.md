# Security Ownership Map — Zabir Boutiques

**Method:** `security-ownership-map` skill — bipartite people↔file graph from git history (last 12 months), with co-change clustering and bus-factor analysis.
**Sensitivity config:** `ownership-sensitivity.csv` (tailored to the V8 plan's security surface — §18).
**Artifacts:** `ownership-map-out/` (people.csv, files.csv, edges.csv, cochange_edges.csv, communities.json, summary.json, commits.jsonl)
**Date:** 2026-08-07

---

## Executive Summary

This is a **bus-factor = 2 project** in the best case, and effectively **bus-factor = 1 for most security-critical subsystems**. The entire security surface — crypto, CSRF, sessions, secrets, auth, money, audit, PII, idempotency — was authored by a single person and has not been touched by anyone else. The V8 plan (§34) assumes "2–4 engineers plus the Owner"; the git history shows **2 contributors**, and security ownership between them is **highly siloed, not shared**.

This is the single most important operational risk in the repo and it is invisible from the code alone.

---

## Contributor Landscape

Only **2 contributors** in the last 12 months, both in **UTC+6 (Bangladesh)**:

| Contributor | Commits | File touches | Primary domains |
|---|---:|---:|---|
| `DelwarOfficial` (delwarofficial@) | 52 | 843 | Security perimeter, auth, RBAC, money, payments, POS, sessions, secrets, audit, PII |
| `delwarnetwork` (delwarnetwork@) | 32 | 648 | Durable Objects, checkout, inventory, fraud, OTP, CSRF, payment webhooks, migrations |

Both are the same human's GitHub identities (timezone, commit cadence, and the git user in repo config confirm this). **Effective bus factor for the project is 1.**

---

## Critical Finding: Security Code Has No Second Owner

Every security-critical category is owned at **50–100% by one identity, with zero overlap** on the most sensitive files. From `summary.json` → `hidden_owners`:

| Category | Dominant owner | Share | Bus factor |
|---|---|---:|---|
| **auth_crypto** (`lib/security.ts` — HMAC, timing-safe compare, CSRF token mint) | DelwarOfficial | **100%** | **1** |
| **csrf** (`lib/csrf.ts` — double-submit validation) | delwarnetwork | **100%** | **1** |
| **session** (`lib/staff-cookies.ts`) | DelwarOfficial | **100%** | **1** |
| **secrets** (`.env.example`) | DelwarOfficial | **100%** | **1** |
| **audit** (`lib/audit.ts`) | DelwarOfficial | **100%** | **1** |
| **pii** (`lib/pii-scrubber.ts` — the log redaction chokepoint) | DelwarOfficial | **100%** | **1** |
| **idempotency** (`lib/idempotency.ts`) | DelwarOfficial | **100%** | **1** |
| **otp** (`lib/phone-verification.ts`) | delwarnetwork | **100%** | **1** |
| **authz** (`lib/rbac.ts`, `lib/api-keys.ts`) | DelwarOfficial | 86% | 1–2 |
| **money** (`lib/money.ts`) | DelwarOfficial | 67% | 1–2 |
| **security_perimeter** (`middleware.ts`) | DelwarOfficial | 76% | 2 |
| **fraud** (`integrations/fraudbd/*`) | delwarnetwork | 88% | **1** |
| **durable_objects** (`src/do/*`) | delwarnetwork | 70% | 2 |
| **payments** | DelwarOfficial | 53% | 2 |
| **checkout** | delwarnetwork | 53% | 2 |

### What this means

- **No security file has been reviewed or touched by a second person.** `src/lib/security.ts` (the HMAC + timing-safe primitives that the payment webhook depends on) has a single owner and was last touched **2026-06-06** — nearly two months ago, with no second set of eyes.
- **The CSRF token logic and the HMAC primitives live with different identities** — if either leaves, the other has never seen the code that the whole money flow depends on.
- **`lib/pii-scrubber.ts` has one owner.** This is the chokepoint that every log line passes through for PII redaction. A regression here is a data-protection incident, and no one else has touched it.

This directly contradicts the V8 plan's §34 premise that Cluster Owners provide per-PR review on security code. The review process exists in prose but not in git history.

---

## Bus-Factor Hotspots (bf = 1, security-sensitive)

These are the highest-priority files for **knowledge transfer / pair-review / documentation**. Filtered to non-migration code (the 60+ single-owner migration files are lower risk since they're append-only history):

| File | Tag | Last touch | Why it matters |
|---|---|---|---|
| `src/lib/security.ts` | auth_crypto | 2026-06-06 | HMAC-SHA256 + timing-safe compare — the root trust primitive for webhooks & CSRF |
| `src/lib/csrf.ts` | csrf | 2026-06-18 | Double-submit CSRF validation for all staff mutations |
| `src/lib/payment-webhook-ingress.ts` | payments | 2026-06-18 | HMAC webhook verify + event-id idempotency — money-in path |
| `src/lib/integrations/payments/index.ts` | payments | 2026-06-19 | UddoktaPay → SSLCommerz fallback facade |
| `src/pages/api/payments/reconcile.ts` | payments | 2026-06-19 | Reconciliation cron — can cancel/verify payments |
| `src/lib/phone-verification.ts` | otp | 2026-06-19 | OTP verification logic |
| `src/lib/staff-cookies.ts` | session | 2026-06-17 | Staff session cookie signing/reading |
| `src/lib/audit.ts` | audit | 2026-06-16 | Append-only audit trail |
| `src/lib/pii-scrubber.ts` | pii | 2026-06-16 | PII redaction chokepoint for all logs |
| `src/lib/idempotency.ts` | idempotency | 2026-06-16 | D1 idempotency lifecycle (checkout/payment replay safety) |
| `src/lib/money.ts` | money | 2026-06-16 | Integer-paisa arithmetic — every price flows through here |
| `src/lib/api-keys.ts` | authz | 2026-06-08 | API key validation |
| `src/do/waf-rules.ts` | durable_objects | 2026-06-16 | WAF rule DO |
| `src/lib/integrations/fraudbd/client.ts` | fraud | 2026-06-19 | FraudBD HTTP client (checkout-blocking) |

> Note: `src/lib/security.ts` is the **most concerning** — it is the oldest untouched security file (2026-06-06), single-owner, and every other security control transitively trusts it.

---

## Orphaned Sensitive Code

**None found.** All sensitive files have a recent touch (within ~2 months). No stale/abandoned security code. This is the one positive signal.

---

## What's Good

- ✅ **No orphaned security code** — everything is recently active.
- ✅ **Co-change communities exist** — the codebase clusters into logical modules (checkout, DOs, payments, staff), so the architecture is coherent.
- ✅ **The two identities have complementary specializations** — one owns the trust/crypto layer, the other owns the DO/state layer. The split is sensible *if* there were cross-review.
- ✅ **Both contributors are in the same timezone** (UTC+6) — no handoff-gap risk from timezone spread.

---

## Recommendations (prioritized)

### R1 — Knowledge transfer on the bf=1 trust primitives (Highest)
The four files below are the **root of trust** for the entire money flow. A second person must be able to review and modify them:
- `src/lib/security.ts` (HMAC, timing-safe compare)
- `src/lib/payment-webhook-ingress.ts` (webhook authenticity)
- `src/lib/csrf.ts` (CSRF validation)
- `src/lib/pii-scrubber.ts` (PII redaction)

**Action:** Produce a short design note for each (what invariant it guarantees, what breaks if it's wrong), then have the non-authoring identity make a small touch (a comment, a test, a refactor) so the bus factor becomes 2 in git history.

### R2 — Enforce the §34 per-PR review that the plan mandates
The plan requires Cluster Owner review on every PR, but the git history shows security files with a single toucher. **Action:** Add a `CODEOWNERS` file that requires review from both contributors on `src/lib/security.ts`, `src/lib/payments.ts`, `src/lib/csrf.ts`, `src/middleware.ts`, and `src/do/**`. This makes the §34 mandate machine-enforced.

### R3 — Add tests authored by the non-owner
For each bf=1 security file, the highest-leverage second touch is a **test written by the other identity** — it proves understanding and creates a regression net. Priority order matches R1.

### R4 — Cross-pollinate the two silos
The crypto/auth side (DelwarOfficial) and the DO/state side (delwarnetwork) never overlap. The V8 plan's hardest correctness requirements sit at the *intersection* (e.g., `applyPaymentVerified` touches both DO state and D1 money). **Action:** Pair-program the next change to `src/lib/payments.ts` and `src/lib/inventory.ts`.

---

## How to re-run

```bash
# Regenerate the map (from repo root)
python "C:\Users\delwa\.zcode\skills\security-ownership-map\scripts\run_ownership_map.py" \
  --repo . --out ownership-map-out --since "12 months ago" \
  --emit-commits --sensitive-config ownership-sensitivity.csv

# Specific queries
python "C:\Users\delwa\.zcode\skills\security-ownership-map\scripts\query_ownership.py" \
  --data-dir ownership-map-out summary --section hidden_owners

python "C:\Users\delwa\.zcode\skills\security-ownership-map\scripts\query_ownership.py" \
  --data-dir ownership-map-out files --tag auth_crypto --bus-factor-max 1
```

The full co-change graph is in `ownership-map-out/cochange.graph.json` (loadable in Neo4j/Gephi per `references/neo4j-import.md` in the skill).
