import type { InvoiceCounterDOContract } from '../lib/contracts/invoice-counter-do';

/**
 * InvoiceCounterDO [V8 §15.5 / 36.7b, RT-008]
 *
 * One instance per UTC day (object ID `invoice-counter:{YYYYMMDD}`). Serializes
 * POS invoice serial issuance across concurrent cashiers. D1 has no
 * SELECT ... FOR UPDATE, so a read-modify-write on a counter row races; the DO
 * is single-threaded per object, making issuance atomic.
 *
 *   receipt_no format: ZB-INV-{YYYYMMDD}-{seq zero-padded to 4}
 *
 * Serials are strictly increasing and never re-issued. If the caller's D1
 * invoice write fails after a serial was issued, the serial is BURNED (the
 * caller records it in invoice_audit with event_type='serial_burned'); a gap is
 * acceptable to a VAT auditor, a duplicate is not.
 *
 * Lifecycle: the object arms a single alarm at end-of-UTC-day + 48h. On fire
 * it deleteAll()s — a new day uses a new object ID, so past-day serials are
 * never re-issued by a future instance.
 */
interface CounterState {
  seq: number;
  date_key: string;
  alarm_armed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 48 * 60 * 60 * 1000;

function endDateKey(dateKey: string): number {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(4, 6)) - 1;
  const d = Number(dateKey.slice(6, 8));
  return Date.UTC(y, m, d) + DAY_MS + GRACE_MS;
}

export class InvoiceCounterDO implements DurableObject, InvoiceCounterDOContract {
  private state: DurableObjectState;
  private cached: CounterState | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  private dateKeyFromName(): string {
    const name = this.state.id.toString();
    const idx = name.indexOf(':');
    return idx >= 0 ? name.slice(idx + 1) : '';
  }

  private async load(): Promise<CounterState> {
    if (this.cached) return this.cached;
    const stored = await this.state.storage.get<CounterState>('counter');
    if (stored) {
      this.cached = stored;
      return this.cached;
    }
    this.cached = { seq: 0, date_key: this.dateKeyFromName(), alarm_armed: false };
    return this.cached;
  }

  private async persist(): Promise<void> {
    if (this.cached) await this.state.storage.put('counter', this.cached);
  }

  private async ensureAlarm(c: CounterState): Promise<void> {
    if (c.alarm_armed) return;
    const expiry = endDateKey(c.date_key);
    if (Number.isFinite(expiry) && expiry > Date.now()) {
      await this.state.storage.setAlarm(expiry);
      c.alarm_armed = true;
      await this.persist();
    }
  }

  async nextInvoiceNumber(input: { staffId: string }): Promise<{ receipt_no: string; seq: number }> {
    return this.fetch(new Request('https://do/next', { method: 'POST', body: JSON.stringify(input) }))
      .then((r) => r.json() as Promise<{ receipt_no: string; seq: number }>);
  }

  async getCurrentSeq(): Promise<{ seq: number; date_key: string }> {
    return this.fetch(new Request('https://do/current')).then((r) => r.json() as Promise<{ seq: number; date_key: string }>);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1) || 'current';
    const c = await this.load();
    await this.ensureAlarm(c);

    if (action === 'current') {
      return Response.json({ ok: true, seq: c.seq, date_key: c.date_key });
    }

    if (action === 'next') {
      // Single-threaded per object: the increment is atomic by construction.
      c.seq += 1;
      const seq = c.seq;
      const receipt_no = `ZB-INV-${c.date_key}-${seq.toString().padStart(4, '0')}`;
      await this.persist();
      return Response.json({ ok: true, receipt_no, seq });
    }

    return Response.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 });
  }

  async alarm(): Promise<void> {
    // End-of-day + 48h grace elapsed. A new day uses a new object ID, so
    // deleteAll is safe — past-day serials are never re-issued.
    await this.state.storage.deleteAll();
    this.cached = null;
  }
}
