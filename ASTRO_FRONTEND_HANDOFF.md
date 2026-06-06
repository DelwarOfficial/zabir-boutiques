# Zabir Boutiques Astro Front-End Handoff

## Project Structure

```text
src/
  components/
    checkout/CheckoutSkeleton.astro
    product/ProductCard.astro
    shell/Header.astro
    shell/CategoryRail.astro
    shell/Footer.astro
    shell/ProductGridSkeleton.astro
  data/
    category-taxonomy.ts
    demo-products.ts
  hooks/useLocalCart.ts
  islands/
    AddToCartButton.tsx
    BottomNav.tsx
    GuestCheckout.tsx
  layouts/RootLayout.astro
  lib/
    cart-store.ts
    inventory.ts
    money.ts
    phone.ts
  pages/
    index.astro
    categories/[slug].astro
    products/[slug].astro
    checkout.astro
    orders.astro
    api/checkout.ts
```

## Performance And UX Strategy

- Astro 5 removed `output: "hybrid"`; this project uses `output: "static"` with the Cloudflare adapter, which preserves the same static-by-default behavior while `prerender = false` routes run in the Worker.
- Public storefront routes export `prerender = true`, so home, category, and product pages are static CDN assets.
- Checkout and API routes export `prerender = false`, keeping mutations in the Cloudflare Workers runtime.
- Layout uses fixed `aspect-ratio` media boxes, fixed-height buttons, stable bottom navigation height, and skeleton blocks that match grid/form structure to prevent CLS.
- Cart state stays in `localStorage` under `zb_cart_v68a`, emits a custom update event, and remains usable while offline.
- All prices in cart, checkout, and API payloads are integer paisa. `formatPaisa()` is the only rendering-layer conversion.
- Checkout sends an idempotency key, normalized phone, integer totals, and line items to `/api/checkout`.
- `OUT_OF_STOCK` responses update the affected local cart line immediately and show a clear recovery message.
