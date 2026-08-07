export interface InventoryVariant {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  size: string | null;
  color: string | null;
  pricePaisa: number;
  quantity: number;
  reserved: number;
  sold: number;
  available: number;
  isAvailable: number;
}

export interface AdjustmentReason {
  value: string;
  label: string;
  description: string;
  isPositive: boolean;
  isNegative: boolean;
}

export const ADJUSTMENT_REASONS: AdjustmentReason[] = [
  { value: 'received', label: 'Stock Received', description: 'New stock arrived from supplier', isPositive: true, isNegative: false },
  { value: 'correction', label: 'Count Correction', description: 'Inventory count discrepancy fix', isPositive: true, isNegative: true },
  { value: 'return', label: 'Customer Return', description: 'Customer returned item', isPositive: true, isNegative: false },
  { value: 'damage', label: 'Damaged / Write-off', description: 'Damaged or expired stock written off', isPositive: false, isNegative: true },
  { value: 'theft', label: 'Theft / Shrinkage', description: 'Missing stock due to theft or loss', isPositive: false, isNegative: true },
  { value: 'sample', label: 'Sample / Promo', description: 'Stock used for sample or promotion', isPositive: false, isNegative: true },
  { value: 'transfer_in', label: 'Transfer In', description: 'Stock transferred from another location', isPositive: true, isNegative: false },
  { value: 'transfer_out', label: 'Transfer Out', description: 'Stock transferred to another location', isPositive: false, isNegative: true },
  { value: 'other', label: 'Other', description: 'Manual adjustment for other reason', isPositive: true, isNegative: true },
];

export interface InventoryMovement {
  id: string;
  variantId: string;
  productName: string;
  sku: string;
  size: string | null;
  color: string | null;
  delta: number;
  reason: string;
  prevQuantity: number | null;
  newQuantity: number | null;
  notes: string | null;
  adjustedBy: string | null;
  adjustedByName: string | null;
  createdAt: string;
}

export interface AdjustStockInput {
  variantId: string;
  delta: number;
  reason: string;
  notes?: string;
}

export interface AdjustStockResult {
  ok: boolean;
  variantId: string;
  previousStock: number;
  newStock: number;
  delta: number;
}

export interface VariantSearchResult {
  ok: boolean;
  variants: InventoryVariant[];
  total: number;
  page: number;
  totalPages: number;
}

export interface MovementListResult {
  ok: boolean;
  movements: InventoryMovement[];
  total: number;
  page: number;
  totalPages: number;
}
