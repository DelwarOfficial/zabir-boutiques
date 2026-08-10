# N-2: Durable Object ID Prefix Migration — Design

## Why this is three different problems, not one

Checking the target format against what each DO's ID actually carries today shows this
isn't a uniform rename. There are three distinct cases:

| Case | DOs | What changes |
|---|---|---|
| **A. Pure rename** | `VariantInventoryDO`, `CartDO`, `DirectCheckoutSessionDO`, `ProviderHealthDO` | Same key, same semantics — just add a `{type}:` prefix string. |
| **B. Partitioning restructure** | `BudgetCounterDO` | Plan wants **one object per provider, forever** (`budget:{provider}`), holding both the daily and monthly bucket internally. Current code creates **one object per provider per day** (`idFromName(\`deepseek:${date}\`)`) — a new DO instance every single day. This is not a rename, it's a different data model inside the DO. |
| **C. Scope plumbing** | `IdempotencyDO` | Plan wants `idem:{scope}:{idempotency_key}` where `scope` is the checkout session (cart/buy-now/staff session id). Current code calls `idFromName(key)` with just the raw key — the session scope isn't threaded through to every call site yet. This needs a caller-side change (pass scope), not just an ID string change. |

`InvoiceCounterDO` (`invoice-counter:${dateKey}`) is already correctly prefixed — no
migration needed. `WafRules` has zero `idFromName` call sites anywhere in the codebase
(unused binding, separately flagged as N-1) — nothing to migrate.

This document designs Case A fully (the common mechanism, reusable for all four DOs in
that case) and scopes B and C as follow-on work with their own risk profile, rather than
forcing them through the same mechanism and getting either wrong.

## Why a naive rename is unsafe

A Durable Object instance is uniquely identified by the string passed to `idFromName()`.
`idFromName("v1")` and `idFromName("variant:v1")` resolve to two **different physical
objects** with independent, non-overlapping persistent storage. Deploying a prefix change
as a pure find-and-replace means every live object's data — active stock reservations,
in-progress carts, buy-now sessions, provider circuit-breaker state — becomes invisible
the instant the new code ships. There is no way to recover it after the fact; the old
storage still exists but nothing will ever ask for it again by that name.

## Case A: the common mechanism

### Key insight: D1 is already authoritative for all four

Every Case A DO already has a **D1 mirror table** that the codebase treats as the
fallback when the DO binding itself is unbound (the established "DO-primary/D1-fallback"
pattern):

| DO | D1 mirror table |
|---|---|
| `VariantInventoryDO` | `inventory_items` |
| `CartDO` | `guest_carts` |
| `DirectCheckoutSessionDO` | `checkout_sessions` |
| `ProviderHealthDO` | `provider_health` |

Because D1 is already the source of truth these DOs sync *to* on every mutation, the
migration does **not** need DO-to-DO peer communication (one DO instance calling
another's `fetch()`, reading its storage, and forwarding it). It only needs each new
(prefixed) DO instance to **hydrate itself from D1** the first time it's touched — the
exact same operation `VariantInventoryDO` already performs via its `/sync` action
(reused today by `dr-parity.ts`'s `restoreParity()` after a disaster-recovery restore).

This eliminates an entire category of risk: no new peer-DO protocol, no two DOs racing
to talk to each other, no new failure mode where the old DO is unreachable. The new DO
just does what every DO already does on cold start after a D1 restore — read D1, adopt
its state.

### Mechanism

1. **Add (or reuse) a `/hydrate-from-d1` action on each Case A DO.**
   `VariantInventoryDO` already has this (`/sync`) — reuse it as-is. The other three
   need a small new action added to their existing `fetch()` dispatch, following the
   same shape: accept the D1 row's fields, overwrite in-memory state, persist, mark
   itself initialized. This is additive to each DO class — no existing action changes.

2. **Guard idempotency inside the DO, not the client.**
   Durable Objects serialize all requests to one instance — no two `fetch()` calls to
   the same object ID ever run concurrently. So the hydrate handler can safely do:
   ```ts
   if (action === "hydrateFromD1") {
     if (this.initialized) return Response.json({ ok: true, alreadyInitialized: true });
     // ...apply body fields, this.initialized = true, persist...
   }
   ```
   Two near-simultaneous requests for the same new key both trigger a hydrate call;
   the DO processes them one at a time, the second one no-ops. No client-side locking
   needed — this is the same guarantee `VariantInventoryDO`'s existing state machine
   already relies on.

3. **Wrap `idFromName` at the call site with a resolver that hydrates-then-resolves:**
   ```ts
   // src/lib/do-client.ts
   async function resolvePrefixedId<T>(
     namespace: DurableObjectNamespace,
     prefixedKey: string,
     hydrate: (stub: DurableObjectStub) => Promise<void>,
   ): Promise<DurableObjectStub> {
     const id = namespace.idFromName(prefixedKey);
     const stub = namespace.get(id);
     const probe = await stub.fetch("https://do/init-status");
     const { initialized } = (await probe.json()) as { initialized: boolean };
     if (!initialized) await hydrate(stub);
     return stub;
   }
   ```
   Every existing `namespace.idFromName(rawKey)` call in `do-client.ts` becomes
   `resolvePrefixedId(namespace, \`variant:${rawKey}\`, (stub) => hydrateFromD1(stub, rawKey))`
   (or the `cart:`/`buy:`/`provider:` equivalent). The `hydrate` callback reads the
   current D1 row for that key and POSTs it to `/hydrate-from-d1`.

4. **Cost:** one extra `fetch()` round-trip (`/init-status`) per call, for every key,
   forever — not just during migration. That's the honest tradeoff of doing this
   client-orchestrated instead of baking a one-time flag into the DO's own cold-start
   path. Phase 3 below removes this permanently once migration is confirmed complete.

### Rollout phases

**Phase 1 — ship the hydrate actions, dark.**
Add `/hydrate-from-d1` (or equivalent) to `CartDO`, `DirectCheckoutSessionDO`,
`ProviderHealthDO`. No caller wired up yet. Deploy. Zero behavior change — this is
pure additive surface, safe to ship and forget for a day to confirm nothing broke.

**Phase 2 — switch call sites to prefixed IDs through the resolver.**
Change `do-client.ts` to use `resolvePrefixedId` with the new prefixed keys. This is
the actual cutover — from this deploy onward, every request resolves to the new
(empty) DO instance, triggers one hydrate-from-D1 on first touch per key, then behaves
normally. Old (unprefixed) DO instances are now orphaned — never addressed again.

*Data at risk during Phase 2's cutover instant:* only whatever changed in the OLD DO's
memory after its last D1 write but before the cutover request arrives. Given every one
of these DOs already writes through to D1 on every mutation (that's what makes them
D1-fallback-capable in the first place), this window is sub-request-sized, not
sub-day-sized. For `VariantInventoryDO` specifically, reservations are also TTL-bounded
(10 minutes) and independently swept by the D1-side hourly cron
(`cleanExpiredReservations`) even if a DO-side alarm is lost — a second, independent
backstop.

**Phase 3 — remove the dual-read overhead.**
After a soak period (recommend 30 days — long enough to cover the longest-lived state
in any of these four DOs, which is a cart; carts don't have a hard TTL today but 30
days covers realistic abandonment), monitoring should show zero remaining
`/init-status` → `not initialized` responses (i.e., nothing is still cold-starting from
legacy state). At that point, remove the resolver wrapper and go back to a direct
`namespace.idFromName(prefixedKey)` call — eliminating the permanent extra round-trip.
This is its own deploy, gated on the monitoring signal, not bundled with Phase 2.

### Rollback

Phase 1 and 2 are independently revertible: Phase 1 is additive-only (revert = delete
the new action, no data implication). Phase 2's revert means going back to raw
`idFromName(rawKey)` — this resumes reading the OLD DO instances, which still have
whatever state they had at the moment of cutover (nothing deletes them). Anything
written to the NEW prefixed instances during the rollback window is what's at risk on
a rollback, bounded by however long Phase 2 was live before someone rolled back.

## Case B: BudgetCounterDO — corrected after reading the actual DO code

**Revising the earlier note above (written before I'd read `budget-counter-do.ts` line
by line): the bucket-tracking logic is not missing. It's already correct and already
there — `recordUsage`/`canUseProvider` already key their counters as
`daily:{provider}:{YYYY-MM-DD}` and `monthly:{provider}:{YYYY-MM}` and already check
both. Someone already wrote the monthly-bucket logic correctly. The entire bug is that
`canUseDeepSeekBudget`/`canUseWorkersAIBudget`/`canUseImagifyBudget`/
`recordDeepSeekUsage` (the four functions in this file that read/write those buckets)
address the object via `idFromName(\`${provider}:${date}\`)` — a fresh, empty-storage
object every UTC day. So on day 2, the "monthly" bucket key gets created fresh in a
*brand new object that never saw day 1's writes* — it reads as `0` regardless of what
day 1 spent. Two correctly-written date-keyed counters, inside an object that itself
gets thrown away and recreated daily, so the monthly one can never accumulate past one
day's worth. This is exactly the C-04/C-05 "never actually enforced" finding — just a
narrower fix than originally scoped.

**This means Case B does not need a data-model change or new rollover logic.** It needs
exactly one thing: stable addressing. Change `idFromName(\`${provider}:${date}\`)` to
`idFromName(\`budget:${provider}\`)` in all four call sites
(`canUseDeepSeekBudget`, `canUseWorkersAIBudget`, `canUseImagifyBudget`,
`recordDeepSeekUsage`) and the existing daily/monthly bucket logic starts working
correctly for free — this collapses to something closer to Case A's "pure rename" than
the data-model rewrite I originally described.

**No D1 hydration is possible or needed.** I checked `ai_budget_limits` — it stores only
*limits* (`daily_limit_usd_cents`, `monthly_limit_usd_cents`, etc.), never *usage*
totals. There is no D1 mirror of spend to hydrate from, for either the old or new
addressing scheme. This is actually simpler than Case A: there's nothing to hydrate,
so this is a **direct cutover** like `ProviderHealthDO` — the new `budget:{provider}`
object starts at `0` on first touch, same as a brand-new provider would today. Worst
case at cutover: the remainder of the current UTC day (and current month) undercounts
by whatever the old per-day object had already recorded before the deploy — a soft
spend guard reading slightly low for at most 24h, not a data-loss or security issue
(compare to the `AI_BUDGET` global/per-actor scopes below, which are already stable and
unaffected).

**New concern this surfaces that pure Case A DOs don't have: unbounded storage growth.**
Every other Case A DO's object has a natural bound on live keys (a cart's line items, a
variant's stock counters). `BudgetCounterDO` under `budget:{provider}` addressing lives
*forever*, and every call adds a new `daily:*`/`monthly:*` key plus a permanent
`usage:{provider}:{request_id}` dedup-guard key that is currently **never removed** —
today this is invisible only because the whole object (and all its keys) gets discarded
every 24h by the very bug we're fixing. Removing that accidental cleanup means adding a
real one:
1. An `alarm()` handler that prunes `daily:*` keys older than 2 days, `monthly:*` keys
   older than 2 months, and `usage:*` dedup keys older than 24h (the dedup window only
   needs to survive a retry storm, not forever).
2. Scheduled via `storage.setAlarm()` on the object's first write (once, if no alarm is
   already pending) rather than re-listing storage on every request — keeps the common
   path (`canUseProvider`/`recordUsage`) at its current cost.

**Not in scope of this fix:** the generic scope-based side of this same DO class
(`configureScope`/`chargeBudget`/`reconcileBudget`, used by `ai-client.ts` for
`ai:global:daily` / `ai:user:anon:daily` / `ai:ip:anon:hourly`) addresses objects by a
caller-controlled scope string that never embeds a date — already stable, not affected
by this bug, not part of Case B.

This is now small enough to build as one concrete deliverable: 4 call-site edits in
`budget-counter-do.ts`, one new `alarm()` handler, no D1 migration, no caller signature
changes (the four exported functions keep their existing signatures — only what they
pass to `idFromName` changes).

## Case C: IdempotencyDO — needs scope plumbing first

The plan's `idem:{scope}:{idempotency_key}` requires knowing the checkout session at
every `doClaim`/`doPeek`/`doComplete`/`doFail` call site. Checking the current call
sites (`checkout.ts`, `buy-now/submit.ts`, `staff/orders/[id]/confirm.ts`) — each
already has a natural scope value available (cart session_id, buy-now session_id,
staff session id respectively), so this is plumbing, not a missing capability. But it
means:

1. `do-client.ts`'s `doClaim(env, key)` signature needs a `scope` parameter added.
2. Every call site needs updating to pass its actual scope value.
3. **Unlike Case A, this DO's state is short-lived by design** — idempotency claims
   expire in minutes (the D1 mirror, `checkout_idempotency`, has a 5-minute
   `expires_at` per the existing code). This substantially lowers migration risk: there
   is no "old long-lived state to preserve" in the way there is for a cart or a stock
   reservation. A live in-flight claim during the cutover instant would, worst case,
   let one retry double-process — the same class of risk idempotency claims already
   guard against via the D1-side unique constraints as a second layer, not a new
   exposure.
4. Given the short TTL, this one can likely skip the hydrate-from-D1 dance entirely:
   cut over the ID format directly, accept that any claim in-flight at the exact
   deploy instant might not be found under its new scoped ID (rare, bounded to
   whatever's mid-flight in a single deploy moment), and let it re-claim cleanly since
   nothing was lost — the operation it's protecting either hasn't started or has its
   own D1-level guard already.

## Recommended sequencing

1. **Case A, Phase 1** (additive, zero risk) — ship hydrate actions for Cart/DirectCheckout/ProviderHealth.
2. **Case C** (short-lived state, direct cutover, no hydrate mechanism needed) — lowest-risk win, closes 1 of the 6.
3. **Case A, Phase 2** for `VariantInventoryDO` alone first (it already has `/sync` built and tested via `dr-parity.ts` — the least new code of the four).
4. **Case A, Phase 2** for Cart/DirectCheckout/ProviderHealth once VariantInventoryDO's cutover is confirmed clean in production.
5. **Case A, Phase 3** for all of Case A after the 30-day soak.
6. **Case B** (BudgetCounterDO) scoped and executed separately — corrected design above shows it's a stable-addressing fix plus a new storage-pruning alarm, not a data-model rewrite; still no dependency on the other five, still worth its own review since it's the one DO where storage now lives forever.

## What I'm not doing without a green light

Implementing all of this now, in one pass, touches 5 DO classes, `do-client.ts`, every
caller of every affected `do*` function, two migrations' worth of new D1 columns for
BudgetCounterDO's monthly bucket, and a live production cutover sequence — the exact
combination of "large blast radius" and "hard to verify without production traffic"
that warrants a deliberate rollout, not a single sitting. Recommend starting with step
2 (IdempotencyDO scope plumbing) as a concrete, low-risk, same-session deliverable if
you want to see the mechanism land now — say the word and I'll build and test that one.
