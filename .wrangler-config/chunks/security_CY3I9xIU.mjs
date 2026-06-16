globalThis.process ??= {};
globalThis.process.env ??= {};
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function generateRandomHex(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function createCsrfToken(secret) {
  const nonce = generateRandomHex(32);
  const hmac = await hmacSha256Hex(nonce, secret);
  return `${nonce}.${hmac}`;
}
async function verifyCsrfToken(token, secret) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [nonce, hmac] = parts;
  if (!nonce || !hmac) return false;
  const expected = await hmacSha256Hex(nonce, secret);
  return timingSafeEqualHex(expected, hmac);
}
export {
  createCsrfToken as c,
  generateRandomHex as g,
  hmacSha256Hex as h,
  timingSafeEqualHex as t,
  verifyCsrfToken as v
};
