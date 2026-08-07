# ADR 0001 — Realign `audit-drift.ts` to V8 §38.2

- **Status:** Proposed (awaiting Owner + Cluster 4 Owner decision per §34.8 step 2)
- **Date:** 2026-08-08
- **Proposer:** V8 landing audit (2026-08-07)
- **Cluster:** 4 — Platform & Migrations
- **Guardrails touched:** none amended directly; affects enforcement of #2 (D-03), #17 (D-41), #6 (D-36), and the §38.2 drift catalog itself

## Context

The V8 landing audit (2026-08-07, `docs/audit/drift-v8-landing-2026-08-07.md`)
found that `scripts/audit/audit-drift.ts` predates the V8 plan and diverges from
Master Plan V8 §38.2 in several material ways. The script is the workhorse of
the §38 drift audit and the §34.4 merge gate, so divergence here means the
audit enforces the wrong rules — or, in the case of D-23, the opposite of the
V8 rule.

## Evidence (divergences found)

1. **Completeness gate count.** `main()` asserts `checks.length !== 44` and exits
   with the message "expected 44 checks (one per guardrail)". V8 §38.4 specifies
   **46 checks** (D-01..D-46). The script ships 44 codes mapped loosely to
   guardrail numbers, not to the §38.2 finding catalog.

2. **D-23 is backwards.** The V8 plan **retires** `idx_stock_reservations_order_active`
   (RT-002; migration 0041 drops it). The script's D-23 check **enforces its
   existence** ("Ensure idx_stock_reservations_order_active exists"). A green run
   of D-23 today means the retired index is present — the opposite of V8
   compliance.

3. **D-03 static-route list was the V7 list.** It included catalog routes and
   `sitemap.xml.ts` as "should prerender", masking the real V8 RT-009 violations.
   The landing audit narrowed this to the §3.3 five routes and surfaced 6 real
   catalog-prerender P0s (now waived under W-2026-01). This piece is already
   fixed; listed here to show the class of divergence.

4. **D-36 enforced the V7 two-timestamp alarm pattern** (`soft_alarm_active`,
   `five_min_alarm_at`, `thirty_day_alarm_at`, `reArmIfNeeded`) which V8 §6.8
   replaces with a single `alarm_purpose` + persist→cleanup handoff. The landing
   audit rewrote D-36 to the V8 pattern; listed for the same reason.

5. **Several check meanings drift from the §38.2 catalog** (D-05, D-17, D-19,
   D-22, D-23, D-29) — the V8 §38.2 table defines specific detection methods and
   fixes that the script's implementations approximate but do not match exactly.

## Proposed change

Rewrite `scripts/audit/audit-drift.ts` so that:

- The completeness gate requires **46** checks, one per §38.2 drift code D-01..D-46.
- Each check's `code`, `severity`, detection method, and `fix` text match §38.2
  verbatim (D-23 flips to *reject* the retired index; D-29 uses the broadened
  regex; etc.).
- The waiver engine added during the landing audit (reads `docs/audit/waivers.md`,
  reports WAIVED, expired waivers stop waiving) is retained.
- The `--glob '!**/*.md'` exclusion for D-01/D-02 (so the plan's own FORBIDDEN
  references don't trip the audit) is preserved per §38.4.

## Alternatives considered

- **A) Leave the script as-is and document the divergence.** Rejected: an audit
  that enforces the wrong rules (D-23) is worse than no audit, because a green
  run gives false confidence. This is exactly the §34.9 "audit theatre" anti-pattern.
- **B) Patch checks one at a time as drift is discovered.** Rejected: the
  divergence is systemic (gate count, code meanings, backwards checks). Point
  patches leave the catalog inconsistent with §38.2 and make the next audit
  harder to trust.
- **C) Full realignment to §38.2 (this proposal).** One deliberate rewrite that
  makes the script the faithful implementation of §38.2, so future drift is
  detected against the real rules.

## Impact

- No production behaviour change (audit tooling only).
- CI: the merge gate becomes stricter (46 checks, several currently-missing
  checks added). Expect a one-time bump in findings as the new checks run;
  these are real drift and should be fixed or waived, not suppressed.
- Tests: `tests/drift-audit-script.test.ts` needs updating to the new check
  count and the corrected D-23 semantics.

## Decision required

Owner + Cluster 4 Owner: approve full realignment (C), or direct a different
path. Until decided, the landing-audit patches to D-03/D-05/D-32/D-36 stand as
surgical fixes and the divergences above remain documented but unresolved.
