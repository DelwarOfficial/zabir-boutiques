---
description: Activate Astro context and consult Astro docs MCP. Usage /astro [task]
agent: build
---

Activate the astro skill for this project. Before answering, consult the Astro Docs MCP server (search_astro_docs tool) for current API syntax — model knowledge lags docs.

Task: $ARGUMENTS

Key project facts:
- Astro 7 SSR, output:"server", @astrojs/cloudflare advanced runtime
- Config: astro.config.mjs
- Validate: npx astro check, tsc --noEmit
- Integrations via astro add, not manual package.json edits
- Background mode: astro dev auto-detaches for agents; lock .astro/dev.json
- Health probe: /_astro/status returns {"ok":true}
