globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, d as renderHead } from "./sequence_XySMyPne.mjs";
import { g as getCurrentStaffUser } from "./rbac_cfH-YcoZ.mjs";
/* empty css                 */
var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const prerender = false;
const $$Login = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Login;
  const user = await getCurrentStaffUser(Astro2);
  if (user) {
    return Astro2.redirect("/staff");
  }
  return renderTemplate(_a || (_a = __template([`<html lang="en" data-theme="light"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"><meta name="theme-color" content="#faf9f7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1a1816" media="(prefers-color-scheme: dark)"><title>Staff Login — Zabir Boutiques</title><script>
      (function(){
        var t = localStorage.getItem('zb-theme');
        if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme:dark)').matches)) {
          document.documentElement.setAttribute('data-theme','dark');
        }
      })();
    <\/script>`, `</head> <body style="margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;"> <main style="width:100%;max-width:380px;padding:2rem;"> <div style="background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:2rem;box-shadow:0 4px 24px rgba(0,0,0,0.06);"> <div style="text-align:center;margin-bottom:1.5rem;"> <div style="font-size:1.5rem;font-weight:800;color:var(--brand);letter-spacing:-0.5px;">Zabir Boutiques</div> <div style="color:var(--muted);font-size:0.85rem;margin-top:0.25rem;">Staff Portal</div> </div> <form id="login-form"> <div style="margin-bottom:1rem;"> <label style="display:block;font-size:0.8rem;color:var(--ink-secondary);margin-bottom:0.3rem;">Email or phone</label> <input name="identifier" type="text" autocomplete="username" required style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:0.9rem;box-sizing:border-box;outline:none;"> </div> <div style="margin-bottom:1.25rem;"> <label style="display:block;font-size:0.8rem;color:var(--ink-secondary);margin-bottom:0.3rem;">Password</label> <input name="password" type="password" autocomplete="current-password" required style="width:100%;padding:0.6rem 0.75rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:0.9rem;box-sizing:border-box;outline:none;"> </div> <button type="submit" id="login-btn" style="width:100%;padding:0.65rem;background:var(--brand);color:#fff;border:none;border-radius:6px;font-size:0.9rem;font-weight:600;cursor:pointer;">
Sign in
</button> <p id="error" style="color:#dc2626;font-size:0.8rem;margin:0.75rem 0 0;text-align:center;display:none;"></p> </form> </div> <p style="text-align:center;color:var(--muted);font-size:0.75rem;margin-top:1.5rem;">Zabir Boutiques &copy; 2026</p> </main> <script>
      const form = document.getElementById('login-form');
      const btn = document.getElementById('login-btn');
      const err = document.getElementById('error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Signing in…';
        const data = new FormData(form);
        const res = await fetch('/api/staff/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: data.get('identifier'), password: data.get('password') })
        });
        if (res.ok) {
          window.location.href = '/staff';
        } else {
          const body = await res.json().catch(() => ({}));
          err.textContent = body.error || 'Login failed';
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Sign in';
        }
      });
    <\/script> </body> </html>`])), renderHead());
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/login.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/login.astro";
const $$url = "/staff/login";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Login,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
