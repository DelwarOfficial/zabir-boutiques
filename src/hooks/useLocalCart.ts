import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CART_UPDATED_EVENT, EMPTY_CART, fetchCartFromServer, invalidateCartCache, readCart, summarizeCart, syncCartToServer, writeCart, type LocalCartItem } from "../lib/cart-store";

function subscribe(onStoreChange: () => void) {
  const sync = () => {
    invalidateCartCache();
    onStoreChange();
  };
  window.addEventListener("storage", sync);
  window.addEventListener(CART_UPDATED_EVENT, sync);
  return () => {
    window.removeEventListener("storage", sync);
    window.removeEventListener(CART_UPDATED_EVENT, sync);
  };
}

function getServerSnapshot(): LocalCartItem[] {
  return EMPTY_CART;
}

export function useLocalCart() {
  const items = useSyncExternalStore(subscribe, readCart, getServerSnapshot);

  useEffect(() => {
    fetchCartFromServer();
  }, []);

  const snapshot = useMemo(() => summarizeCart(items), [items]);

  return {
    ...snapshot,
    addItem(item: LocalCartItem) {
      const current = readCart();
      const existing = current.find((cartItem) => cartItem.variantId === item.variantId);
      const next = existing
        ? current.map((cartItem) =>
            cartItem.variantId === item.variantId
              ? { ...cartItem, quantity: cartItem.quantity + item.quantity, availableQuantity: item.availableQuantity }
              : cartItem
          )
        : [...current, item];
      writeCart(next);
      syncCartToServer("add", { variantId: item.variantId, quantity: item.quantity });
    },
    updateQuantity(variantId: string, quantity: number) {
      const next = readCart()
        .map((item) => (item.variantId === variantId ? { ...item, quantity } : item))
        .filter((item) => item.quantity > 0);
      const removed = next.length < readCart().length;
      writeCart(next);
      if (removed) {
        syncCartToServer("remove", { variantId });
      } else {
        syncCartToServer("quantity", { variantId, quantity });
      }
    },
    clear() {
      writeCart([]);
      syncCartToServer("clear");
    },
  };
}
