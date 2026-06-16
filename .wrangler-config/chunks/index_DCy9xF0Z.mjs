globalThis.process ??= {};
globalThis.process.env ??= {};
import { c as createComponent } from "./astro-component_mvRJbLGV.mjs";
import { r as renderTemplate, m as maybeRenderHead } from "./sequence_XySMyPne.mjs";
import { f as renderComponent } from "./worker-entry_CjpE2ho_.mjs";
import { $ as $$StaffLayout } from "./StaffLayout_CdcerS8F.mjs";
import { $ as $$PageHeader } from "./PageHeader_93CCipe8.mjs";
import { g as getCurrentStaffUser, f as can } from "./rbac_cfH-YcoZ.mjs";
var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));
var _a;
const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Index;
  const user = await getCurrentStaffUser(Astro2);
  if (!user) return Astro2.redirect("/staff/login");
  if (!can(user.role, "media.upload")) return new Response("Forbidden", { status: 403 });
  return renderTemplate`${renderComponent($$result, "StaffLayout", $$StaffLayout, { "title": "Media Upload", "user": user }, { "default": async ($$result2) => renderTemplate(_a || (_a = __template([" ", " ", `<div class="bg-surface border-2 border-dashed border-line rounded-lg p-8 text-center max-w-lg mx-auto"> <form id="upload-form" action="/api/staff/uploads" method="post" enctype="multipart/form-data" class="flex flex-col items-center gap-4"> <label class="cursor-pointer"> <div class="text-muted text-sm mb-2">Select an image (JPEG, PNG, WebP, GIF, AVIF — max 20MB)</div> <input type="file" name="file" accept="image/*" required class="text-sm"> </label> <div> <label class="block text-xs text-ink-secondary mb-1">Product ID</label> <input name="product_id" type="text" required placeholder="paste product UUID" class="px-3 py-2 border border-line rounded-md text-sm bg-bg text-ink box-border w-64 font-mono"> </div> <button type="submit" id="upload-btn" class="px-5 py-2 bg-brand text-white rounded-md text-sm font-semibold border-0 cursor-pointer disabled:opacity-50">Upload</button> <p id="upload-msg" class="text-xs m-0 hidden"></p> </form> </div> <script>
  (function() {
    const form = document.getElementById('upload-form');
    const btn = document.getElementById('upload-btn');
    const msg = document.getElementById('upload-msg');
    function getCsrf() {
      const m = document.cookie.match(/(?:^|;\\s*)csrf-token=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    }
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = 'Uploading…';
      msg.className = 'text-xs m-0 hidden';
      const data = new FormData(form);
      try {
        const res = await fetch('/api/staff/uploads', {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
          body: data
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
          msg.textContent = 'Uploaded: ' + json.r2_key + (json.compressed ? ' (compressed)' : '');
          msg.className = 'text-xs m-0 text-green-700';
        } else {
          msg.textContent = json.error || json.message || 'Upload failed.';
          msg.className = 'text-xs m-0 text-red-600';
        }
      } catch {
        msg.textContent = 'Network error.';
        msg.className = 'text-xs m-0 text-red-600';
      }
      btn.disabled = false; btn.textContent = 'Upload';
    });
  })();
<\/script> `], [" ", " ", `<div class="bg-surface border-2 border-dashed border-line rounded-lg p-8 text-center max-w-lg mx-auto"> <form id="upload-form" action="/api/staff/uploads" method="post" enctype="multipart/form-data" class="flex flex-col items-center gap-4"> <label class="cursor-pointer"> <div class="text-muted text-sm mb-2">Select an image (JPEG, PNG, WebP, GIF, AVIF — max 20MB)</div> <input type="file" name="file" accept="image/*" required class="text-sm"> </label> <div> <label class="block text-xs text-ink-secondary mb-1">Product ID</label> <input name="product_id" type="text" required placeholder="paste product UUID" class="px-3 py-2 border border-line rounded-md text-sm bg-bg text-ink box-border w-64 font-mono"> </div> <button type="submit" id="upload-btn" class="px-5 py-2 bg-brand text-white rounded-md text-sm font-semibold border-0 cursor-pointer disabled:opacity-50">Upload</button> <p id="upload-msg" class="text-xs m-0 hidden"></p> </form> </div> <script>
  (function() {
    const form = document.getElementById('upload-form');
    const btn = document.getElementById('upload-btn');
    const msg = document.getElementById('upload-msg');
    function getCsrf() {
      const m = document.cookie.match(/(?:^|;\\\\s*)csrf-token=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    }
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = 'Uploading…';
      msg.className = 'text-xs m-0 hidden';
      const data = new FormData(form);
      try {
        const res = await fetch('/api/staff/uploads', {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
          body: data
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
          msg.textContent = 'Uploaded: ' + json.r2_key + (json.compressed ? ' (compressed)' : '');
          msg.className = 'text-xs m-0 text-green-700';
        } else {
          msg.textContent = json.error || json.message || 'Upload failed.';
          msg.className = 'text-xs m-0 text-red-600';
        }
      } catch {
        msg.textContent = 'Network error.';
        msg.className = 'text-xs m-0 text-red-600';
      }
      btn.disabled = false; btn.textContent = 'Upload';
    });
  })();
<\/script> `])), renderComponent($$result2, "PageHeader", $$PageHeader, { "title": "Media Upload", "subtitle": "Upload product images. Automatically compressed with WebP thumbnails." }), maybeRenderHead()) })}`;
}, "D:/Antigravity/zabir-boutiques/src/pages/staff/media/index.astro", void 0);
const $$file = "D:/Antigravity/zabir-boutiques/src/pages/staff/media/index.astro";
const $$url = "/staff/media";
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
