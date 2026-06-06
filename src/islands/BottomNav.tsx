import { Grid3X3, Home, ReceiptText, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocalCart } from "../hooks/useLocalCart";

const navItems = [
  { href: "/", label: "Home", icon: Home, match: (path: string) => path === "/" },
  { href: "/categories/pakistani-collection", label: "Categories", icon: Grid3X3, match: (path: string) => path.startsWith("/categories") },
  { href: "/checkout", label: "Cart", icon: ShoppingBag, match: (path: string) => path.startsWith("/checkout") },
  { href: "/orders", label: "Orders", icon: ReceiptText, match: (path: string) => path.startsWith("/orders") },
];

export function BottomNav() {
  const [pathname, setPathname] = useState("/");
  const cart = useLocalCart();
  const cartLabel = useMemo(() => (cart.itemCount > 9 ? "9+" : String(cart.itemCount)), [cart.itemCount]);

  useEffect(() => {
    setPathname(window.location.pathname);
  }, []);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] glass px-3 pb-[env(safe-area-inset-bottom)] pt-2 md:hidden shadow-[0_-2px_12px_rgba(0,0,0,0.04)]">
      <div className="mx-auto grid max-w-lg grid-cols-4 gap-1">
        {navItems.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl text-[11px] font-semibold transition-all duration-200 active:scale-95 ${
                active ? "text-[var(--brand)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon aria-hidden="true" className={`mb-0.5 h-5 w-5 transition-all duration-200 ${active ? "scale-110" : ""}`} strokeWidth={2} />
              <span>{item.label}</span>
              {item.label === "Cart" && cart.itemCount > 0 ? (
                <span className="absolute -right-1 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--brand)] px-1 text-[9px] font-bold text-white">{cartLabel}</span>
              ) : null}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
