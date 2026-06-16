import { Grid3X3, Home, ReceiptText, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocalCart } from "../hooks/useLocalCart";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  match: (path: string) => boolean;
};

const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: Home, match: (path) => path === "/" },
  { href: "/categories/pakistani-collection", label: "Shop", icon: Grid3X3, match: (path) => path.startsWith("/categories") },
  { href: "/checkout", label: "Cart", icon: ShoppingBag, match: (path) => path.startsWith("/checkout") },
  { href: "/orders", label: "Orders", icon: ReceiptText, match: (path) => path.startsWith("/orders") },
];

export function BottomNav() {
  const [pathname, setPathname] = useState("/");
  const [bump, setBump] = useState(0);
  const cart = useLocalCart();
  const cartLabel = useMemo(() => (cart.itemCount > 9 ? "9+" : String(cart.itemCount)), [cart.itemCount]);

  useEffect(() => {
    setPathname(window.location.pathname);
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Bump the cart badge whenever the count increases (add-to-cart feedback).
  useEffect(() => {
    if (cart.itemCount > 0) setBump((b) => b + 1);
  }, [cart.itemCount]);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 md:hidden glass-nav safe-bottom pt-1.5 shadow-[0_-8px_30px_rgba(0,0,0,0.06)]"
    >
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1 px-1">
        {navItems.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`press tap-44 relative flex flex-col items-center justify-center rounded-2xl text-[10px] font-semibold transition-colors duration-200 ${
                active ? "text-[var(--brand)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`relative mb-0.5 grid h-7 w-7 place-items-center rounded-full transition-all duration-300 ${
                  active ? "bg-[var(--brand-light)] scale-110" : "bg-transparent scale-100"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 2} />
                {item.label === "Cart" && cart.itemCount > 0 ? (
                  <span
                    key={bump}
                    className="pop absolute -right-1 -top-1 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-[var(--brand)] px-1 text-[9px] font-bold text-white shadow-sm"
                    aria-label={`${cart.itemCount} items in cart`}
                  >
                    {cartLabel}
                  </span>
                ) : null}
              </span>
              <span className={active ? "opacity-100" : "opacity-90"}>{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
