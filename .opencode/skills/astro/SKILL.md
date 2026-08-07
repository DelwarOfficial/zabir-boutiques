---
name: astro
description: Astro, /astro, Astro components, integrations, Astro MCP server, astro add, background mode, /_astro/status health endpoint. Use when working with Astro pages, components, config, integrations, or answering Astro API questions in this project.
---

# Astro

Project uses Astro 7 (`package.json`), server output on Cloudflare via `@astrojs/cloudflare` adapter. Config: `astro.config.mjs`. Validate with `npx astro check`; typecheck `tsc --noEmit`.

## Docs Access (MCP)

Astro Docs MCP server configured in `opencode.json`: `https://mcp.docs.astro.build/mcp`. Search it before answering Astro API questions — model knowledge lags docs, especially newer features (sessions, actions, server islands, caching) and changed ones (content collections). Always verify current API against docs; never trust stale patterns.

## Build Best Practices

- Start from existing templates or `npm create astro@latest` with template option instead of scaffolding from scratch.
- Use `astro add` for official integrations (`astro add tailwind`, `astro add react`, `astro add cloudflare`), not manual `package.json` edits.
- Install other packages with the project's package manager, not by editing `package.json` directly.
- Check docs for features that changed since launch (content collections) or previously experimental features that may have stabilized.

## Background Mode (astro >= 7.0.0)

- `astro dev` and `astro preview` auto-start detached when AI coding agent detected — server does not block terminal.
- Lock file `.astro/dev.json` or `.astro/preview.json` records URL, port, PID; prevents duplicate servers.
- Opt out: `ASTRO_DEV_BACKGROUND=0 astro dev` or `ASTRO_PREVIEW_BACKGROUND=0 astro preview`.
- Dev server exposes `/_astro/status` → `{"ok": true}` JSON. Probe it to check server readiness before requests. Production builds have no such endpoint.
