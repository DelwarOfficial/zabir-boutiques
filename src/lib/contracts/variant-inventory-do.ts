export interface VariantInventoryDOContract {
  reserve(input: { variant_id: string; quantity: number; checkout_id: string }): Promise<{ reservation_id: string } | { error: 'INSUFFICIENT_STOCK'; available: number }>;
  release(input: { reservation_id: string; reason: string }): Promise<{ released: boolean; already_released?: boolean }>;
  confirm(input: { reservation_id: string; order_id: string }): Promise<{ confirmed: true } | { error: 'RESERVATION_NOT_FOUND' | 'ALREADY_CONFIRMED' }>;
  directSale(input: { variant_id: string; quantity: number; invoice_id: string; staff_id: string; channel: 'pos' }): Promise<{ success: true; inventory_mutation_id: string } | { error: 'INSUFFICIENT_STOCK'; available: number } | { error: 'CONFLICT'; message: string }>;
  reverseDirectSale(input: { variant_id: string; quantity: number; invoice_id: string; reason: string }): Promise<{ reversed: true; audit_event_id: string } | { reversed: false; audit_event_id: string; message: 'already_reversed' }>;
  adjustStock(input: { variant_id: string; delta: number; reason: string; staff_id: string; notes?: string }): Promise<{ ok: true; previous_stock: number; new_stock: number; adjustment_id: string } | { ok: false; error: string; current_stock?: number }>;
  getAvailability(input: { variant_id: string }): Promise<{ stock: number; reserved: number; sold: number; available: number }>;
}
