/**
 * CSP hash loader [Master_Prompt v7.0 §9.5]
 *
 * At build time, scripts/csp-hashes-plugin.mjs walks
 * dist/client/_astro, computes SHA-256 hashes, and writes the
 * resulting array into src/generated/csp-hashes.ts. The Worker
 * imports that module directly — no node:fs access at runtime.
 *
 * If the file is missing (e.g. dev mode without a fresh build),
 * the array is empty and the middleware falls back to a
 * relaxed CSP that still requires the per-request nonce.
 */
import { CSP_SCRIPT_HASHES, CSP_SCRIPT_HASHES_VERSION, CSP_STYLE_HASHES, CSP_STYLE_HASHES_VERSION } from "../generated/csp-hashes";

export function getCspScriptHashes(): readonly string[] {
  return CSP_SCRIPT_HASHES;
}

export function getCspHashesVersion(): string {
  return CSP_SCRIPT_HASHES_VERSION;
}

/**
 * N-13, phase 1 (ship dark): generated but not yet consumed by
 * src/lib/security/csp.ts. style-src still reads `'self' 'unsafe-inline'`
 * only. See docs/audit/N-13-CSP-STYLE-HASH-DESIGN.md for why wiring this
 * in is a separate, deliberate cutover deploy.
 */
export function getCspStyleHashes(): readonly string[] {
  return CSP_STYLE_HASHES;
}

export function getCspStyleHashesVersion(): string {
  return CSP_STYLE_HASHES_VERSION;
}
