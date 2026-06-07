# Zabir Boutiques — Agent Rules

## Architecture

This project is the **Zabir Boutiques AI Commerce Platform v6.8D** — an **Astro + Cloudflare** platform (static output with on-demand server routes via adapter) deployed on **Cloudflare Pages + Workers**.

- **Framework:** Astro with `output: "static"` + `@astrojs/cloudflare` adapter (APIs and dynamic routes execute in the Worker)
- **Database:** Cloudflare D1 (SQLite) — absolute source of truth
- **Storage:** Cloudflare R2 for media, KV for caching
- **Payment:** UddoktaPay (server-to-server verification only)
- **Fraud:** FraudBD (risk signal only, D1 is source of truth)

## Key Guardrails

- D1 is SQLite. Use only SQLite-compatible syntax.
- All money values are INTEGER paisa. No floating-point money.
- Checkout never trusts KV or CDN stock — uses fresh D1 conditional updates.
- Never create order rows before `reserveVariants()` succeeds.
- Public stock badge API must NOT write KV.
- UddoktaPay paid status requires server-to-server verification.
- Store only HMAC-SHA256 hashes of staff session tokens.
- All non-GET staff mutations require CSRF.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists.
- After modifying code, run `graphify update .` to keep the graph current.
