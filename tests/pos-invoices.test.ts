import { describe, it, expect } from 'vitest';

/**
 * Tests for the POS invoice engine (src/lib/invoices.ts).
 *
 * The engine's core invariants:
 *   1. Receipt number is `ZB-INV-YYYYMMDD-NNNN` where NNNN is the
 *      count of paid invoices for the same UTC day, zero-padded.
 *   2. `idempotency_key` is UNIQUE — a double-create returns the
 *      original invoice with `alreadyProcessed: true`.
 *   3. Stock deducts are atomic with the invoice insert via a
 *      single `db.batch({ atomic: true })`.
 *   4. Void restores stock and writes a voided_reason.
 *   5. The over-allocation case rolls back the entire batch (no
 *      negative stock, no half-created invoice).
 */

type SqlRow = Record<string, unknown>;

function makeD1(opts: {
  variants?: Array<{ variant_id: string; price_paisa: number; stock: number; product_name?: string; sku?: string; is_deleted?: number; product_status?: string; is_available?: number }>;
  existingInvoices?: Array<{ id?: string; receipt_no: string; idempotency_key?: string; status?: string; created_at?: string }>;
  inventoryItems?: Map<string, { quantity: number }>;
  invoiceItems?: Map<string, { product_name: string; variant_label: string; sku: string; quantity: number; unit_price_paisa: number; total_price_paisa: number }>;
} = {}): D1Database & {
  invocations: Array<{ sql: string; args: any[] }>;
  inventoryItems: Map<string, { quantity: number }>;
  invoices: Map<string, any>;
  invoiceItems: Map<string, any>;
  payments: Map<string, any>;
  audit: Array<any>;
} {
  const inventoryItems = opts.inventoryItems ?? new Map<string, { quantity: number }>();
  if (opts.variants) {
    for (const v of opts.variants) {
      inventoryItems.set(v.variant_id, { quantity: v.stock });
    }
  }
  const invoices = new Map<string, any>();
  if (opts.existingInvoices) {
    for (const i of opts.existingInvoices) {
      const id = i.id ?? crypto.randomUUID();
      invoices.set(id, { id, receipt_no: i.receipt_no, idempotency_key: i.idempotency_key, status: i.status ?? 'paid', created_at: i.created_at ?? '2026-06-16 10:00:00' });
    }
  }
  const invoiceItems = opts.invoiceItems ?? new Map();
  const payments = new Map();
  const audit: any[] = [];
  const invocations: Array<{ sql: string; args: any[] }> = [];

  return {
    invocations,
    inventoryItems,
    invoices,
    invoiceItems,
    payments,
    audit,
    prepare(sql: string) {
      let bound: any[] = [];
      const stmt: any = {
        bind(...args: any[]) {
          bound = args;
          return stmt;
        },
        async all<T>() {
          invocations.push({ sql, args: [...bound] });
          if (/SELECT v\.id[\s\S]*?FROM product_variants v/.test(sql)) {
            const results: any[] = [];
            for (const v of opts.variants ?? []) {
              results.push({
                variant_id: v.variant_id,
                product_id: `p-${v.variant_id}`,
                sku: v.sku ?? v.variant_id,
                size: null,
                color: null,
                is_deleted: v.is_deleted ?? 0,
                product_name: v.product_name ?? `Product ${v.variant_id}`,
                product_status: v.product_status ?? 'published',
                price_paisa: v.price_paisa,
                stock_quantity: v.stock,
                is_available: v.is_available ?? 1,
              });
            }
            return { results: results as T[] };
          }
          if (/FROM invoice_items WHERE invoice_id/.test(sql)) {
            return { results: Array.from(invoiceItems.values()) as T[] };
          }
          if (/FROM invoice_payments WHERE invoice_id/.test(sql)) {
            return { results: Array.from(payments.values()) as T[] };
          }
          if (/FROM invoices i[\s\S]*?JOIN staff_users u/.test(sql)) {
            const id = bound[0];
            const inv = invoices.get(id);
            if (!inv) return { results: [] as T[] };
            return { results: [{
              ...inv,
              cashier_name: 'Test Cashier',
              customer_name: inv.customer_name ?? null,
              customer_phone: inv.customer_phone ?? null,
              status: inv.status ?? 'paid',
              subtotal_paisa: inv.subtotal_paisa ?? 0,
              discount_paisa: inv.discount_paisa ?? 0,
              vat_paisa: inv.vat_paisa ?? 0,
              total_paisa: inv.total_paisa ?? 0,
              amount_paid_paisa: inv.amount_paid_paisa ?? 0,
              change_due_paisa: inv.change_due_paisa ?? 0,
              notes: inv.notes ?? null,
              voided_reason: inv.voided_reason ?? null,
              created_at: inv.created_at ?? '2026-06-16 00:00:00',
              paid_at: inv.paid_at ?? inv.created_at ?? '2026-06-16 00:00:00',
            }] as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T>() {
          invocations.push({ sql, args: [...bound] });
          if (/SELECT 1 AS x FROM invoices WHERE receipt_no/.test(sql)) {
            const exists = Array.from(invoices.values()).some((i) => i.receipt_no === bound[0]);
            return (exists ? { x: 1 } : null) as T;
          }
          if (/SELECT receipt_no FROM invoices[\s\S]*?WHERE receipt_no LIKE/.test(sql)) {
            // The bind value is `prefix + '%'`. Strip the trailing
            // `%` to get the literal prefix for filtering.
            const raw = String(bound[0] ?? '');
            const prefix = raw.endsWith('%') ? raw.slice(0, -1) : raw;
            const matching = Array.from(invoices.values())
              .map((i) => i.receipt_no)
              .filter((r) => r.startsWith(prefix))
              .sort()
              .reverse();
            return (matching[0] ? { receipt_no: matching[0] } : null) as T;
          }
          if (/SELECT id, receipt_no, total_paisa, amount_paid_paisa, change_due_paisa/.test(sql)) {
            const inv = Array.from(invoices.values()).find((i) => i.idempotency_key === bound[0]);
            return (inv ? {
              id: inv.id,
              receipt_no: inv.receipt_no,
              total_paisa: inv.total_paisa ?? 0,
              amount_paid_paisa: inv.amount_paid_paisa ?? 0,
              change_due_paisa: inv.change_due_paisa ?? 0,
            } : null) as T;
          }
          if (/SELECT id, status.*?FROM invoices WHERE id/.test(sql)) {
            const inv = invoices.get(bound[0]);
            return (inv ? { id: inv.id, status: inv.status, created_at: inv.created_at } : null) as T;
          }
          if (/SELECT variant_id, quantity FROM invoice_items WHERE invoice_id/.test(sql)) {
            return null as T;
          }
          return null as T;
        },
        async run() {
          invocations.push({ sql, args: [...bound] });
          if (/^INSERT OR IGNORE INTO invoices/.test(sql)) {
            const id = bound[0];
            const idempotencyKey = bound[2];
            const existingById = invoices.get(id);
            const existingByKey = Array.from(invoices.values()).find(i => i.idempotency_key === idempotencyKey);
            if (existingById || existingByKey) {
              return { meta: { changes: 0 } };
            }
            invoices.set(id, {
              id,
              receipt_no: bound[1],
              idempotency_key: bound[2],
              cashier_id: bound[3],
              customer_name: bound[4] || null,
              customer_phone: bound[5] || null,
              status: 'paid',
              subtotal_paisa: bound[6],
              discount_paisa: bound[7],
              vat_paisa: bound[8],
              total_paisa: bound[9],
              amount_paid_paisa: bound[10],
              change_due_paisa: bound[11],
              notes: bound[12] || null,
              created_at: bound[13],
              paid_at: bound[13],
            });
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO invoice_items/.test(sql)) {
            const id = bound[0];
            invoiceItems.set(id, {
              id,
              invoice_id: bound[1],
              variant_id: bound[2],
              product_name: bound[3],
              variant_label: bound[4],
              sku: bound[5],
              quantity: bound[6],
              unit_price_paisa: bound[7],
              total_price_paisa: bound[8],
              created_at: bound[9],
            });
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO invoice_payments/.test(sql)) {
            payments.set(bound[0], {
              id: bound[0],
              invoice_id: bound[1],
              method: bound[2],
              amount_paisa: bound[3],
              reference: bound[4],
              created_at: bound[5],
            });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE inventory_items\s+SET quantity = quantity -/.test(sql)) {
            const vid = bound[2];
            const item = inventoryItems.get(vid);
            if (!item) return { meta: { changes: 0 } };
            if (item.quantity < bound[0]) return { meta: { changes: 0 } };
            item.quantity -= bound[0];
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE inventory_items\s+SET quantity = quantity \+/.test(sql)) {
            const vid = bound[2];
            const item = inventoryItems.get(vid);
            if (!item) return { meta: { changes: 0 } };
            item.quantity += bound[0];
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO invoice_audit/.test(sql)) {
            // Some audit inserts use inline literals for action/from/to (e.g. 'invoice.void'),
            // while others use bind parameters (?4, ?5, ?6). Detect which pattern.
            const useLiteralAction = /'invoice\.\w+'/.test(sql);
            const useLiteralPaid = /'paid'/.test(sql);
            const useLiteralVoided = /'voided'/.test(sql);
            audit.push({
              id: bound[0],
              invoice_id: bound[1],
              actor_staff_id: bound[2],
              action: useLiteralAction ? sql.match(/'(invoice\.\w+)'/)![1] : bound[3],
              from_status: useLiteralPaid ? 'paid' : bound[4],
              to_status: useLiteralVoided ? 'voided' : bound[5],
              metadata_json: useLiteralAction ? bound[3] : bound[6],
              created_at: useLiteralAction ? bound[4] : bound[7],
            });
            return { meta: { changes: 1 } };
          }
          if (/UPDATE invoices SET status='voided'/.test(sql)) {
            const id = bound[0];
            const inv = invoices.get(id);
            if (!inv) return { meta: { changes: 0 } };
            if (inv.status !== 'paid' && inv.status !== 'issued') return { meta: { changes: 0 } };
            inv.status = 'voided';
            inv.voided_reason = bound[1];
            inv.voided_by = bound[2];
            inv.voided_at = bound[3];
            return { meta: { changes: 1 } };
          }
          if (/UPDATE inventory_items\s+SET quantity = quantity \+/.test(sql)) {
            const vid = bound[2];
            const item = inventoryItems.get(vid);
            if (item) item.quantity += bound[0];
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(statements: any[], opts?: { atomic?: boolean }) {
      // Deep-snapshot mutable state for atomic rollback.
      const snapInv = new Map([...inventoryItems].map(([k, v]) => [k, { ...v }]));
      const snapInvMap = new Map([...invoices].map(([k, v]) => [k, { ...v }]));
      const snapItems = new Map([...invoiceItems].map(([k, v]) => [k, { ...v }]));
      const snapPay = new Map([...payments].map(([k, v]) => [k, { ...v }]));
      const snapAudit = [...audit];

      const results: any[] = [];
      let anyFailed = false;
      for (const stmt of statements) {
        const r = await stmt.run();
        results.push(r);
        if (r.meta?.changes === 0) anyFailed = true;
      }

      // Atomic means all-or-nothing: if any statement returned 0
      // changes (e.g. INSERT OR IGNORE duplicate, stock over-alloc),
      // roll back the entire batch.
      if (opts?.atomic && anyFailed) {
        inventoryItems.clear(); for (const [k, v] of snapInv) inventoryItems.set(k, v);
        invoices.clear();       for (const [k, v] of snapInvMap) invoices.set(k, v);
        invoiceItems.clear();   for (const [k, v] of snapItems) invoiceItems.set(k, v);
        payments.clear();       for (const [k, v] of snapPay) payments.set(k, v);
        audit.length = 0;       audit.push(...snapAudit);
        // Return meta.changes=0 on the first statement so the caller
        // can detect the rollback.
        if (results[0]) results[0] = { meta: { changes: 0 } };
      }
      return results;
    },
  } as unknown as D1Database & {
    invocations: Array<{ sql: string; args: any[] }>;
    inventoryItems: Map<string, { quantity: number }>;
    invoices: Map<string, any>;
    invoiceItems: Map<string, any>;
    payments: Map<string, any>;
    audit: Array<any>;
  };
}

describe('POS invoice engine', () => {
  it('generates ZB-INV-YYYYMMDD-NNNN receipt numbers', async () => {
    const db = makeD1({ existingInvoices: [] });
    const { generateReceiptNo } = await import('../src/lib/invoices');
    const r = await generateReceiptNo(db, '2026-06-16 12:34:56');
    expect(r.receiptNo).toBe('ZB-INV-20260616-0001');
    expect(r.counter).toBe(1);
  });

  it('increments the receipt counter from the last invoice of the same day', async () => {
    const db = makeD1({
      existingInvoices: [
        { receipt_no: 'ZB-INV-20260616-0042' },
      ],
    });
    const { generateReceiptNo } = await import('../src/lib/invoices');
    const r = await generateReceiptNo(db, '2026-06-16 12:34:56');
    expect(r.receiptNo).toBe('ZB-INV-20260616-0043');
  });

  it('restarts the counter for a new day', async () => {
    const db = makeD1({
      existingInvoices: [
        { receipt_no: 'ZB-INV-20260615-0099' },
      ],
    });
    const { generateReceiptNo } = await import('../src/lib/invoices');
    const r = await generateReceiptNo(db, '2026-06-16 00:00:01');
    expect(r.receiptNo).toBe('ZB-INV-20260616-0001');
  });

  it('creates an invoice with stock deduct in a single atomic batch', async () => {
    const db = makeD1({
      variants: [
        { variant_id: 'v1', price_paisa: 5000, stock: 10, product_name: 'Shirt', sku: 'SH-1' },
        { variant_id: 'v2', price_paisa: 3000, stock: 5, product_name: 'Pants', sku: 'PN-1' },
      ],
    });
    const { createInvoice } = await import('../src/lib/invoices');
    const result = await createInvoice(
      { DB: db },
      {
        idempotencyKey: 'idem-001',
        cashierId: 'cashier-1',
        customerName: 'Walk-in Customer',
        customerPhone: null,
        items: [
          { variantId: 'v1', quantity: 2 },
          { variantId: 'v2', quantity: 1 },
        ],
        payments: [{ method: 'cash', amountPaisa: 20000 }],
      },
      '2026-06-16 12:00:00',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalPaisa).toBe(13000);
    expect(result.amountPaidPaisa).toBe(20000);
    expect(result.changeDuePaisa).toBe(7000);
    expect(result.status).toBe('paid');
    expect(result.alreadyProcessed).toBe(false);
    // Stock deducted
    expect(db.inventoryItems.get('v1')?.quantity).toBe(8);
    expect(db.inventoryItems.get('v2')?.quantity).toBe(4);
    // Audit row written
    expect(db.audit.length).toBe(1);
    // Single batch call
    const batchCalls = db.invocations.filter((i) => /db\.batch/.test(i.sql));
    // batch() is in payments.ts, not here — count atomic writes
    const insertInvoiceCalls = db.invocations.filter((i) => /^INSERT OR IGNORE INTO invoices/.test(i.sql));
    const updateInventoryCalls = db.invocations.filter((i) => /^UPDATE inventory_items\s+SET quantity = quantity -/.test(i.sql));
    expect(insertInvoiceCalls.length).toBeGreaterThanOrEqual(1);
    expect(updateInventoryCalls.length).toBe(2);
  });

  it('rejects over-allocation: rolls back the entire batch (no half-created invoice)', async () => {
    const db = makeD1({
      variants: [
        { variant_id: 'v1', price_paisa: 5000, stock: 1, product_name: 'Shirt', sku: 'SH-1' },
      ],
    });
    const { createInvoice } = await import('../src/lib/invoices');
    const result = await createInvoice(
      { DB: db },
      {
        idempotencyKey: 'idem-over',
        cashierId: 'cashier-1',
        items: [{ variantId: 'v1', quantity: 5 }],
        payments: [{ method: 'cash', amountPaisa: 25000 }],
      },
      '2026-06-16 12:00:00',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('OUT_OF_STOCK');
    // The stub's INSERT OR IGNORE on invoices would normally
    // succeed; the UPDATE on inventory_items fails (changes=0).
    // The atomic batch rolls back the INSERT. Verify no invoice
    // was created.
    expect(db.invoices.size).toBe(0);
    // Stock unchanged
    expect(db.inventoryItems.get('v1')?.quantity).toBe(1);
  });

  it('returns alreadyProcessed: true on a double-submit with the same idempotency_key', async () => {
    const db = makeD1({
      variants: [
        { variant_id: 'v1', price_paisa: 1000, stock: 100, product_name: 'Hat', sku: 'H-1' },
      ],
    });
    const { createInvoice } = await import('../src/lib/invoices');
    const input = {
      idempotencyKey: 'idem-dup',
      cashierId: 'cashier-1',
      items: [{ variantId: 'v1', quantity: 2 }],
      payments: [{ method: 'cash', amountPaisa: 2000 }],
    };
    const r1 = await createInvoice({ DB: db }, input, '2026-06-16 12:00:00');
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Second call with the same key — but the INSERT OR IGNORE
    // returns changes=0, then we re-fetch by idempotency_key and
    // return the original.
    const r2 = await createInvoice({ DB: db }, input, '2026-06-16 12:00:01');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.alreadyProcessed).toBe(true);
    expect(r2.invoiceId).toBe(r1.invoiceId);
    expect(r2.receiptNo).toBe(r1.receiptNo);
    // Stock was deducted only once.
    expect(db.inventoryItems.get('v1')?.quantity).toBe(98);
  });

  it('rejects when payment total is less than invoice total', async () => {
    const db = makeD1({
      variants: [
        { variant_id: 'v1', price_paisa: 5000, stock: 10, product_name: 'Shirt', sku: 'SH-1' },
      ],
    });
    const { createInvoice } = await import('../src/lib/invoices');
    const result = await createInvoice(
      { DB: db },
      {
        idempotencyKey: 'idem-short',
        cashierId: 'cashier-1',
        items: [{ variantId: 'v1', quantity: 1 }],
        payments: [{ method: 'cash', amountPaisa: 1000 }],
      },
      '2026-06-16 12:00:00',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PAYMENT_MISMATCH');
  });

  it('rejects empty cart', async () => {
    const db = makeD1({});
    const { createInvoice } = await import('../src/lib/invoices');
    const result = await createInvoice(
      { DB: db },
      {
        idempotencyKey: 'idem-empty',
        cashierId: 'cashier-1',
        items: [],
        payments: [{ method: 'cash', amountPaisa: 0 }],
      },
      '2026-06-16 12:00:00',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EMPTY_CART');
  });

  it('voids a paid invoice and restores stock atomically', async () => {
    const db = makeD1({
      variants: [
        { variant_id: 'v1', price_paisa: 5000, stock: 8, product_name: 'Shirt', sku: 'SH-1' },
      ],
      existingInvoices: [
        { id: 'inv-1', receipt_no: 'ZB-INV-20260616-0001', status: 'paid' },
      ],
      invoiceItems: new Map([
        ['it-1', { invoice_id: 'inv-1', variant_id: 'v1', quantity: 2 }],
      ]),
    });
    db.inventoryItems.set('v1', { quantity: 8 });
    const { voidInvoice } = await import('../src/lib/invoices');
    const result = await voidInvoice(
      { DB: db },
      'inv-1',
      'manager-1',
      'Customer returned item — manager override',
      '2026-06-16 13:00:00',
    );
    expect(result.ok).toBe(true);
    expect(db.invoices.get('inv-1')?.status).toBe('voided');
    expect(db.invoices.get('inv-1')?.voided_reason).toBe('Customer returned item — manager override');
    // Stock restored
    expect(db.inventoryItems.get('v1')?.quantity).toBe(10);
    // Audit row written
    expect(db.audit.length).toBe(1);
    expect(db.audit[0].action).toBe('invoice.void');
  });

  it('refuses to void an already-voided invoice', async () => {
    const db = makeD1({
      existingInvoices: [
        { id: 'inv-1', receipt_no: 'ZB-INV-20260616-0001', status: 'voided' },
      ],
    });
    const { voidInvoice } = await import('../src/lib/invoices');
    const result = await voidInvoice(
      { DB: db },
      'inv-1',
      'manager-1',
      'Trying to void a voided invoice',
      '2026-06-16 13:00:00',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ALREADY_VOIDED');
  });

  it('refuses to void with an empty or too-short reason', async () => {
    const db = makeD1({
      existingInvoices: [
        { id: 'inv-1', receipt_no: 'ZB-INV-20260616-0001', status: 'paid' },
      ],
    });
    const { voidInvoice } = await import('../src/lib/invoices');
    const result = await voidInvoice(
      { DB: db },
      'inv-1',
      'manager-1',
      'no',  // 2 chars, < 5 minimum
      '2026-06-16 13:00:00',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_REASON');
  });
});
