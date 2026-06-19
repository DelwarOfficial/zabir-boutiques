import { addPaisa, multiplyPaisa, type Paisa } from "./money";

export type LocalCartItem = {
  variantId: string;
  productId: string;
  title: string;
  imageUrl: string;
  variantLabel: string;
  unitPricePaisa: Paisa;
  quantity: number;
  availableQuantity?: number;
};

export const CART_STORAGE_KEY = "zb_cart_v68a";
export const CART_UPDATED_EVENT = "zb-cart-updated";
export const EMPTY_CART: LocalCartItem[] = [];

let cachedCart: LocalCartItem[] | null = null;
let syncInProgress = false;
let pendingSyncCount = 0;

function loadCart(): LocalCartItem[] {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (raw === null) return EMPTY_CART;
    const parsed = JSON.parse(raw) as LocalCartItem[];
    if (!Array.isArray(parsed)) return EMPTY_CART;
    const validItems = parsed.filter((item) => item.variantId && Number.isSafeInteger(item.quantity) && item.quantity > 0);
    return validItems.length > 0 ? validItems : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}

export function readCart(): LocalCartItem[] {
  if (cachedCart === null) {
    cachedCart = loadCart();
  }
  return cachedCart;
}

export function writeCart(items: LocalCartItem[]) {
  cachedCart = items;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
  }
}

export function summarizeCart(items: LocalCartItem[]) {
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalPaisa: addPaisa(items.map((item) => multiplyPaisa(item.unitPricePaisa, item.quantity))),
  };
}

export function applyOutOfStockUpdate(variantId: string, availableQuantity = 0) {
  const next = readCart()
    .map((item) => (item.variantId === variantId ? { ...item, quantity: Math.min(item.quantity, Math.max(0, availableQuantity)), availableQuantity } : item))
    .filter((item) => item.quantity > 0);
  writeCart(next);
  syncCartToServer("replace_all", { items: next }).catch(() => {});
}

export function invalidateCartCache() {
  cachedCart = null;
}

export async function fetchCartFromServer(): Promise<void> {
  if (typeof window === "undefined") return;
  if (syncInProgress) return;
  if (pendingSyncCount > 0) return;
  syncInProgress = true;
  try {
    const resp = await fetch("/api/cart", { credentials: "include" });
    if (!resp.ok) return;
    const data: { ok?: boolean; items?: LocalCartItem[] } = await resp.json();
    if (data.ok && Array.isArray(data.items) && data.items.length > 0) {
      writeCart(data.items as LocalCartItem[]);
    }
  } catch {
    // network error — keep localStorage cache
  } finally {
    syncInProgress = false;
  }
}

export async function syncCartToServer(action: string, body: Record<string, unknown> = {}): Promise<void> {
  if (typeof window === "undefined") return;
  pendingSyncCount++;
  try {
    await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    // silent — localStorage has the data; next readCart will retry sync
  } finally {
    pendingSyncCount--;
  }
}
