globalThis.process ??= {};
globalThis.process.env ??= {};
async function cleanExpiredIdempotencyKeys(db) {
  const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
  await db.prepare(
    `DELETE FROM checkout_idempotency WHERE expires_at < ?1`
  ).bind(now).run();
}
export {
  cleanExpiredIdempotencyKeys
};
