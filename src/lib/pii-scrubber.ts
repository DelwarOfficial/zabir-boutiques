/**
 * PII Scrubber [Master_Prompt v7.0 §17.1, G9]
 *
 * Replace PII fields with `[REDACTED]` before any structured log line is
 * emitted. We use this everywhere `console.log/warn/error` could leak
 * customer PII (phone, address, email).
 */

const PII_KEYS = new Set([
  "phone",
  "phone_number",
  "address",
  "delivery_address",
  "email",
  "customer_email",
  "password",
  "token",
  "session_token",
  "csrf_token",
  "card_number",
  "card_cvv",
  "cardholder",
]);

const PHONE_REGEX = /(\+?88)?01[3-9]\d{8}/g;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function scrubString(s: string): string {
  return s.replace(PHONE_REGEX, "[PHONE]").replace(EMAIL_REGEX, "[EMAIL]");
}

function scrubValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return scrubString(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(scrubValue);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (PII_KEYS.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = scrubValue(val);
      }
    }
    return out;
  }
  return v;
}

export interface SafeLogContext {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Format a log line with PII fields scrubbed. Returns a structured
 * JSON string suitable for Logpush ingestion.
 */
export function formatLog(entry: SafeLogContext): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level: entry.level,
    message: scrubString(entry.message),
    data: entry.data ? (scrubValue(entry.data) as Record<string, unknown>) : undefined,
  });
}

/**
 * Convenience wrapper around console.log/warn/error that scrubs PII.
 * Drop-in replacement.
 */
export const safeLog = {
  info: (message: string, data?: Record<string, unknown>) => console.info(formatLog({ level: "info", message, data })),
  warn: (message: string, data?: Record<string, unknown>) => console.warn(formatLog({ level: "warn", message, data })),
  error: (message: string, data?: Record<string, unknown>) => console.error(formatLog({ level: "error", message, data })),
  debug: (message: string, data?: Record<string, unknown>) => console.debug(formatLog({ level: "debug", message, data })),
};
