/**
 * Content Moderation [Master_Prompt v7.0 §13.4, Phase 6.4]
 *
 * Three-stage pipeline:
 *
 *   1. **Block-list / regex** (cheap, deterministic): catch
 *      phone numbers, emails, URLs in user content. We're a
 *      clothing store — users can post reviews (future) and
 *      contact-form messages; the latter must not contain PII
 *      or off-platform contact info.
 *   2. **Workers AI @cf/openai/text-moderation-latest** (or
 *      whichever moderation model is bound in the env). Flags
 *      sexual, hateful, violent content.
 *   3. **Hard-coded safe boundary**: anything stage 2 flags as
 *      > 0.5 prob in the hate/sexual/violence buckets is
 *      rejected; "soft" flags (e.g. low-confidence) are
 *      auto-quarantined and surfaced to staff.
 *
 * Result:
 *   { ok, decision: "allow" | "quarantine" | "block", reasons[] }
 */
export type ModerationDecision = "allow" | "quarantine" | "block";
export interface ModerationResult {
  ok: boolean;
  decision: ModerationDecision;
  reasons: string[];
  scores?: Record<string, number>;
}

const PII_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "email", re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i },
  { name: "phone_bd", re: /(?:\+?880|0)1[3-9]\d{8}\b/ },
  { name: "url", re: /https?:\/\/[^\s]+/i },
  { name: "credit_card", re: /\b(?:\d[ -]?){13,16}\b/ },
];

const SOFT_FLAG_TERMS = [
  "guaranteed", "100% money back", "limited time only", "click here",
  "free money", "telegram", "whatsapp me", "inbox me",
];

const HARD_BLOCK_TERMS = [
  "fuck", "shit", "cunt", "asshole", "bitch", "slut", "whore",
  "kill yourself", "kys",
];

const VENDOR_KEYWORDS = [
  "reseller", "dropshipper", "wholesale price", "bulk order 100",
];

export interface ModerationInput {
  text: string;
  field: string; // e.g. "review.body", "contact.message"
  userId?: string;
}

export async function moderate(env: { AI?: Ai }, input: ModerationInput): Promise<ModerationResult> {
  const text = (input.text ?? "").slice(0, 10_000);
  if (!text) return { ok: false, decision: "block", reasons: ["empty"] };

  const reasons: string[] = [];
  const piiHits: string[] = [];
  for (const { name, re } of PII_PATTERNS) {
    if (re.test(text)) piiHits.push(name);
  }
  if (piiHits.length > 0) reasons.push("pii:" + piiHits.join(","));
  // PII alone is not a hard block — it's a quarantine signal that
  // staff should review before publishing.
  if (piiHits.length > 0) {
    return { ok: false, decision: "quarantine", reasons };
  }

  // Stage 1 — keyword check.
  const lower = text.toLowerCase();
  const softHits = SOFT_FLAG_TERMS.filter(t => lower.includes(t));
  const hardHits = HARD_BLOCK_TERMS.filter(t => lower.includes(t));
  const vendorHits = VENDOR_KEYWORDS.filter(t => lower.includes(t));
  if (hardHits.length > 0) return { ok: false, decision: "block", reasons: ["hard:" + hardHits.join(",")] };
  if (vendorHits.length > 0) return { ok: false, decision: "block", reasons: ["vendor:" + vendorHits.join(",")] };
  if (softHits.length > 0) reasons.push("soft:" + softHits.join(","));

  // Stage 2 — Workers AI moderation.
  let scores: Record<string, number> = {};
  if (env.AI) {
    try {
      // The current Cloudflare text-moderation model returns a
      // { flagged: boolean, categories: {...}, scores: {...} }
      // shape. The exact model name is configured in wrangler.jsonc
      // via the `ai` binding (default: @cf/openai/text-moderation-latest).
      const resp = (await env.AI.run("@cf/openai/text-moderation-latest" as never, { input: text })) as
        | { scores?: Record<string, number>; flagged?: boolean }
        | undefined;
      scores = resp?.scores ?? {};
    } catch (err) {
      // Fail-open with a soft flag if the AI call errors. The store
      // is the source of truth and the failure is recorded.
      reasons.push("ai_error");
      try { const { safeLog } = await import('./pii-scrubber'); safeLog.warn("[moderation] ai error", { error: err instanceof Error ? err.message : String(err) }); } catch {}
    }
  }
  const high = Object.entries(scores).filter(([, v]) => v > 0.5);
  if (high.length > 0) return { ok: false, decision: "block", reasons: ["ai:" + high.map(([k]) => k).join(",")], scores };
  const elevated = Object.entries(scores).filter(([, v]) => v > 0.2);
  if (elevated.length > 0) reasons.push("ai_soft:" + elevated.map(([k]) => k).join(","));
  if (softHits.length > 0 || elevated.length > 0) return { ok: false, decision: "quarantine", reasons, scores };

  return { ok: true, decision: "allow", reasons: [], scores };
}
