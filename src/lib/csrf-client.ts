/**
 * Client-side CSRF token helper.
 * Reads from window.__ZB_CSRF__ (set by StaffLayout) with sessionStorage fallback.
 */
export function getCsrf(): string {
  if (typeof window.__ZB_CSRF__ === 'string' && window.__ZB_CSRF__) return window.__ZB_CSRF__;
  try { return sessionStorage.getItem('zb-csrf') || ''; } catch { return ''; }
}
