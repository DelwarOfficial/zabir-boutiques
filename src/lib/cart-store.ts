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
export const CART_VERSION_KEY = "zb_cart_version";
export const CART_UPDATED_EVENT = "zb-cart-updated";
export const EMPTY_CART: LocalCartItem[] = [];

let cachedCart: LocalCartItem[] | null = null;
let syncInProgress = false;
let pendingSyncCount = 0;
let cachedVersion = -1;

export const SID_COOKIE = 'zb_cart_sid';

export function readCartSessionId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${SID_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

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

function readVersion(): number {
  if (cachedVersion >= 0) return cachedVersion;
  if (typeof window === "undefined") return -1;
  try {
    cachedVersion = Number(window.localStorage.getItem(CART_VERSION_KEY)) || -1;
  } catch {
    cachedVersion = -1;
  }
  return cachedVersion;
}

function writeVersion(version: number) {
  cachedVersion = version;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CART_VERSION_KEY, String(version));
    } catch { }
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
    const data = await resp.json() as { ok?: boolean; items?: LocalCartItem[]; currentVersion?: number };
    if (data.ok && Array.isArray(data.items)) {
      writeCart(data.items as LocalCartItem[]);
      if (typeof data.currentVersion === "number") {
        writeVersion(data.currentVersion);
      }
    }
  } catch {
  } finally {
    syncInProgress = false;
  }
}

export async function syncCartToServer(action: string, body: Record<string, unknown> = {}): Promise<void> {
  if (typeof window === "undefined") return;
  const clientVersion = readVersion();
  pendingSyncCount++;
  try {
    const resp = await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action, clientVersion, ...body }),
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({} as Record<string, unknown>)) as { items?: LocalCartItem[]; currentVersion?: number };
      if (Array.isArray(data.items)) {
        writeCart(data.items as LocalCartItem[]);
      }
      if (typeof data.currentVersion === "number") {
        writeVersion(data.currentVersion);
      }
    }
  } catch {
  } finally {
    pendingSyncCount--;
  }
}
