/**
 * COD ceiling + velocity limits [Master Plan V8 §11.1 step 11, S-04]
 *
 * The quantity-only COD threshold (calculatePrepayment, <=2 items) does not
 * stop a single high-value item from shipping COD, and nothing stops the
 * same phone/address placing repeated COD orders back to back. Both checks
 * are server-side and read their thresholds from site_settings so the
 * Owner can tune them without a deploy.
 */
import { safeLog } from './pii-scrubber';

const DEFAULTS = {
  maxCodValuePaisa: 500_000, // BDT 5,000
  codOrdersPerPhone24h: 2,
  codOrdersPerAddress24h: 3,
};

async function readIntSetting(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare(`SELECT value FROM site_settings WHERE key = ?1`).bind(key).first<{ value: string }>();
    if (row && row.value !== '') {
      const parsed = Number(row.value);
      if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
    }
  } catch (err) {
    safeLog.warn('[cod-limits] site_settings lookup failed, using default', { key, error: err instanceof Error ? err.message : String(err) });
  }
  return fallback;
}

export type CodLimitResult =
  | { ok: true }
  | { ok: false; reason: 'COD_VALUE_EXCEEDED' | 'COD_PHONE_VELOCITY' | 'COD_ADDRESS_VELOCITY' };

/**
 * normalizedAddress should be a stable, comparable form of the delivery
 * address (trimmed, collapsed whitespace, lowercased) — not necessarily
 * the exact text stored on the order, just consistent enough that repeat
 * orders to "the same place" count against each other.
 */
export async function checkCodLimits(
  db: D1Database,
  input: { totalPaisa: number; normalizedPhone: string; normalizedAddress: string },
): Promise<CodLimitResult> {
  const [maxValuePaisa, perPhone, perAddress] = await Promise.all([
    readIntSetting(db, 'commerce.max_cod_value_paisa', DEFAULTS.maxCodValuePaisa),
    readIntSetting(db, 'commerce.cod_orders_per_phone_24h', DEFAULTS.codOrdersPerPhone24h),
    readIntSetting(db, 'commerce.cod_orders_per_address_24h', DEFAULTS.codOrdersPerAddress24h),
  ]);

  if (input.totalPaisa > maxValuePaisa) {
    return { ok: false, reason: 'COD_VALUE_EXCEEDED' };
  }

  const phoneCount = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM orders
       WHERE phone = ?1 AND payment_method = 'cod' AND created_at > datetime('now', '-24 hours')`,
    )
    .bind(input.normalizedPhone)
    .first<{ c: number }>();
  if ((phoneCount?.c ?? 0) >= perPhone) {
    return { ok: false, reason: 'COD_PHONE_VELOCITY' };
  }

  const addressCount = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM orders
       WHERE lower(trim(address)) = ?1 AND payment_method = 'cod' AND created_at > datetime('now', '-24 hours')`,
    )
    .bind(input.normalizedAddress)
    .first<{ c: number }>();
  if ((addressCount?.c ?? 0) >= perAddress) {
    return { ok: false, reason: 'COD_ADDRESS_VELOCITY' };
  }

  return { ok: true };
}

export const COD_LIMIT_MESSAGES: Record<Exclude<CodLimitResult, { ok: true }>['reason'], string> = {
  COD_VALUE_EXCEEDED: 'This order value requires advance payment. Please pay online to confirm.',
  COD_PHONE_VELOCITY: 'Too many cash-on-delivery orders from this number in the last 24 hours. Please pay online or try again later.',
  COD_ADDRESS_VELOCITY: 'Too many cash-on-delivery orders to this address in the last 24 hours. Please pay online or try again later.',
};
