/**
 * InvoiceCounterDO contract — V8 Section 15.5 / 36.7b (RT-008).
 *
 * One Durable Object instance per UTC day (object ID: `invoice-counter:{YYYYMMDD}`).
 * The ONLY legal source of `invoices.receipt_no`. D1 has no SELECT ... FOR UPDATE,
 * so a read-modify-write on a counter row is not safe under concurrency; the DO
 * serializes serial issuance across concurrent cashiers.
 *
 * Bangladesh VAT (Mushak) requires sequential, non-duplicated invoice serials.
 * If a caller's D1 invoice write fails after a serial was issued, the serial is
 * BURNED (recorded in invoice_audit as 'serial_burned'), not reused: a gap is
 * acceptable to an auditor, a duplicate is not.
 */
export interface InvoiceCounterDOContract {
  /** Issue the next serial for the day. Strictly increasing, never re-issued. */
  nextInvoiceNumber(input: { staffId: string }): Promise<{ receipt_no: string; seq: number }>;
  /** Read-only current counter, for the staff dashboard. */
  getCurrentSeq(): Promise<{ seq: number; date_key: string }>;
}
