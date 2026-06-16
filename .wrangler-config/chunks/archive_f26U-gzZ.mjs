globalThis.process ??= {};
globalThis.process.env ??= {};
async function archiveOldEvents(db, backups, auditLedgerSecret) {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1e3).toISOString().replace("T", " ").slice(0, 19);
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const oldEvents = await db.prepare(
    `SELECT * FROM payment_events WHERE created_at < ?1`
  ).bind(cutoff).all();
  if (oldEvents.results && oldEvents.results.length > 0) {
    await backups.put(
      `backups/archives/${date}-payment-events.json`,
      JSON.stringify(oldEvents.results, null, 2)
    );
    await db.prepare(
      `DELETE FROM payment_events WHERE created_at < ?1`
    ).bind(cutoff).run();
  }
  const oldAudit = await db.prepare(
    `SELECT * FROM audit_log WHERE created_at < ?1 ORDER BY created_at ASC, rowid ASC`
  ).bind(cutoff).all();
  if (oldAudit.results && oldAudit.results.length > 0) {
    const payload = JSON.stringify(oldAudit.results, null, 2);
    const digest = await sha256Hex(payload);
    const first = oldAudit.results[0];
    const last = oldAudit.results[oldAudit.results.length - 1];
    const manifest = {
      type: "audit_log_archive",
      date,
      row_count: oldAudit.results.length,
      first_audit_id: first.id,
      first_previous_hash: first.previous_hash,
      last_audit_id: last.id,
      last_chain_hash: last.chain_hash,
      payload_sha256: digest,
      signature: auditLedgerSecret ? await hmacSha256Hex(digest, auditLedgerSecret) : null
    };
    await backups.put(
      `backups/archives/${date}-audit-log.json`,
      payload
    );
    await backups.put(
      `backups/archives/${date}-audit-log.manifest.json`,
      JSON.stringify(manifest, null, 2)
    );
  }
}
async function sha256Hex(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha256Hex(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export {
  archiveOldEvents
};
