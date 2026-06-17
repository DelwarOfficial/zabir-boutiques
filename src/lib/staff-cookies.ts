const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True when the request is plain HTTP against a loopback dev host. */
export function isLocalHttpDev(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
}

export function staffSessionCookieName(request: Request): string {
  return isLocalHttpDev(request) ? 'session' : '__Host-session';
}

export function staffCsrfCookieName(request: Request): string {
  return isLocalHttpDev(request) ? 'csrf-token' : '__Host-csrf-token';
}

function cookieBaseAttrs(request: Request, maxAge: number): string {
  const parts = ['Path=/', `Max-Age=${maxAge}`, 'SameSite=Strict'];
  if (!isLocalHttpDev(request)) parts.push('Secure');
  return parts.join('; ');
}

export function appendStaffAuthCookies(
  headers: Headers,
  request: Request,
  opts: { sessionToken: string; csrfToken: string; maxAge: number },
): void {
  const base = cookieBaseAttrs(request, opts.maxAge);
  headers.append(
    'Set-Cookie',
    `${staffSessionCookieName(request)}=${opts.sessionToken}; HttpOnly; ${base}`,
  );
  headers.append(
    'Set-Cookie',
    `${staffCsrfCookieName(request)}=${opts.csrfToken}; ${base}`,
  );
}

export function clearStaffAuthCookies(headers: Headers, request: Request): void {
  const base = cookieBaseAttrs(request, 0);
  headers.append('Set-Cookie', `${staffSessionCookieName(request)}=; HttpOnly; ${base}`);
  headers.append('Set-Cookie', `${staffCsrfCookieName(request)}=; ${base}`);
}

function readNamedCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function readStaffSessionCookie(request: Request): string | null {
  return readNamedCookie(request, staffSessionCookieName(request));
}

export function readStaffCsrfCookie(request: Request): string | null {
  return readNamedCookie(request, staffCsrfCookieName(request));
}