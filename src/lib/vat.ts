/**
 * VAT Computation (canonical) [Master Plan V8 §11.7]
 *
 * Single source of truth for VAT rate lookup, tax amount, and per-line
 * allocation. VAT_RATE_PERCENT is retired — rate now comes from D1
 * `tax_rates`, read in the same request as pricing (not KV, not a secret:
 * KV is eventually consistent and two orders seconds apart could carry
 * different VAT on a legally binding invoice).
 */

export interface OrderLineForVat {
  id: string;
  linePaisa: number; // this line's share of the taxable base (e.g. unit_price * qty)
}

/**
 * Rate for `applies_to` ('goods' | 'delivery') effective at `now`
 * (SQL-format 'YYYY-MM-DD HH:MM:SS'). Returns 0 when no row is effective —
 * VAT stays off until an Owner + VAT consultant seed a real rate (D-03).
 */
export async function getVatRatePercent(
  db: D1Database,
  appliesTo: 'goods' | 'delivery',
  now: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT rate_percent FROM tax_rates
       WHERE applies_to = ?1 AND effective_from <= ?2 AND (effective_to IS NULL OR effective_to > ?2)
       ORDER BY effective_from DESC LIMIT 1`,
    )
    .bind(appliesTo, now)
    .first<{ rate_percent: number }>();
  return row?.rate_percent ?? 0;
}

/**
 * vat_paisa = floor(taxable_base_paisa * rate_percent / 100 + 0.5) — half-up,
 * integer arithmetic only, no floats beyond the single + 0.5 step.
 */
export function calculateVatPaisa(taxableBasePaisa: number, ratePercent: number): number {
  if (!Number.isFinite(ratePercent) || ratePercent <= 0 || taxableBasePaisa <= 0) return 0;
  return Math.floor((taxableBasePaisa * ratePercent) / 100 + 0.5);
}

/**
 * Largest-remainder allocation of `totalVatPaisa` across order lines so the
 * per-line values sum exactly to `totalVatPaisa`. Each line's exact share is
 * floored, then the remaining paisa are distributed one at a time to the
 * lines with the largest fractional remainders, ties broken by ascending id.
 */
export function allocateVatByLargestRemainder(
  lines: OrderLineForVat[],
  totalVatPaisa: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (lines.length === 0) return result;
  if (totalVatPaisa <= 0) {
    for (const line of lines) result.set(line.id, 0);
    return result;
  }

  const baseSum = lines.reduce((sum, l) => sum + l.linePaisa, 0);
  if (baseSum <= 0) {
    // No taxable base to allocate against — put it all on the first line
    // (by id order) rather than silently dropping paisa.
    const sorted = [...lines].sort((a, b) => a.id.localeCompare(b.id));
    for (const line of sorted) result.set(line.id, 0);
    result.set(sorted[0].id, totalVatPaisa);
    return result;
  }

  const shares = lines.map((line) => {
    const exact = (line.linePaisa / baseSum) * totalVatPaisa;
    const floor = Math.floor(exact);
    return { id: line.id, floor, remainder: exact - floor };
  });

  let allocated = shares.reduce((sum, s) => sum + s.floor, 0);
  let remaining = totalVatPaisa - allocated;

  const byRemainder = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.id.localeCompare(b.id);
  });

  for (const s of shares) result.set(s.id, s.floor);
  for (let i = 0; i < remaining; i++) {
    const target = byRemainder[i % byRemainder.length];
    result.set(target.id, (result.get(target.id) ?? 0) + 1);
  }

  return result;
}
