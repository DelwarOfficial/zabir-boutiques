/** Routes and patterns that must never be cached by the service worker. */
export const PWA_NETWORK_ONLY_PATTERNS: readonly RegExp[] = [
  /^\/api(?:\/|$)/,
  /^\/staff(?:\/|$)/,
  /^\/checkout(?:\/|$)/,
  /^\/orders(?:\/|$)/,
  /^\/order-track(?:\/|$)/,
  /^\/buy-now(?:\/|$)/,
  /^\/_image(?:\/|$)/,
  /^\/_server-islands(?:\/|$)/,
];

export function isPwaNetworkOnlyPath(pathname: string): boolean {
  return PWA_NETWORK_ONLY_PATTERNS.some((re) => re.test(pathname));
}