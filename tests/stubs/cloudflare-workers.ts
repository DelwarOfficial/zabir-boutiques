/**
 * Test stub for the `cloudflare:workers` virtual module.
 *
 * In production this module is provided by the Workers runtime and exposes the
 * environment bindings. Under Vitest (Node), it does not exist, so this stub is
 * aliased in via vitest.config.ts. An empty `env` is sufficient for the pure
 * RBAC/menu unit tests, which never touch DB bindings.
 */
export const env: Record<string, unknown> = {};
