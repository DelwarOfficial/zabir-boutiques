globalThis.process ??= {};
globalThis.process.env ??= {};
async function hashPassword(password, salt, pepper) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const combinedSalt = new TextEncoder().encode(salt + pepper);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: combinedSalt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyPassword(password, storedHash, salt, pepper) {
  if (!salt) return false;
  const computed = await hashPassword(password, salt, pepper);
  if (computed.length !== storedHash.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) result |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return result === 0;
}
async function legacyHashPassword(password, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(password));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export {
  hashPassword as h,
  legacyHashPassword as l,
  verifyPassword as v
};
