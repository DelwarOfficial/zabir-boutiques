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
import { CSP_SCRIPT_HASHES, CSP_SCRIPT_HASHES_VERSION } from "../generated/csp-hashes";

export function getCspScriptHashes(): readonly string[] {
  return CSP_SCRIPT_HASHES;
}

export function getCspHashesVersion(): string {
  return CSP_SCRIPT_HASHES_VERSION;
}
