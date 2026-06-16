globalThis.process ??= {};
globalThis.process.env ??= {};
async function verifyTurnstile(env, token, remoteIp) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: true };
  }
  if (!token) return { ok: false, errors: ["missing-token"] };
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  if (!res.ok) return { ok: false, errors: [`http_${res.status}`] };
  const data = await res.json();
  return data;
}
export {
  verifyTurnstile as v
};
