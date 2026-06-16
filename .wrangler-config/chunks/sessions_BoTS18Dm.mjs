globalThis.process ??= {};
globalThis.process.env ??= {};
async function hashSessionToken(token, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function cleanExpiredSessions(db) {
  const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
  await db.prepare(
    `DELETE FROM staff_sessions WHERE absolute_expires_at < ?1 OR (is_revoked = 1)`
  ).bind(now).run();
}
export {
  cleanExpiredSessions,
  generateSessionToken,
  hashSessionToken
};
