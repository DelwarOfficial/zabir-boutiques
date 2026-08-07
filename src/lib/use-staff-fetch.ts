import { useState, useCallback, useRef } from 'react';
import { getCsrf } from './csrf-client';

interface StaffFetchOptions extends RequestInit {
  skipCsrf?: boolean;
}

interface StaffFetchResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  fetch: (url: string, opts?: StaffFetchOptions) => Promise<T | null>;
  reset: () => void;
}

/**
 * React hook for authenticated staff API calls.
 * Automatically attaches CSRF token and parses JSON responses.
 */
export function useStaffFetch<T = any>(): StaffFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef(false);

  const fetchFn = useCallback(async (url: string, opts: StaffFetchOptions = {}): Promise<T | null> => {
    const { skipCsrf, ...fetchOpts } = opts;

    if (activeRef.current) return null;
    activeRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        ...(fetchOpts.headers as Record<string, string>),
      };
      if (!skipCsrf) {
        headers['X-CSRF-Token'] = getCsrf();
      }
      if (!headers['Content-Type'] && !(fetchOpts.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(url, { ...fetchOpts, headers });
      const json: any = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        const msg = json.error || json.message || `Request failed (${res.status})`;
        setError(msg);
        setData(null);
        activeRef.current = false;
        setLoading(false);
        return null;
      }

      setData(json as T);
      activeRef.current = false;
      setLoading(false);
      return json as T;
    } catch (err: any) {
      const msg = err?.message || 'Network error';
      setError(msg);
      setData(null);
      activeRef.current = false;
      setLoading(false);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, error, loading, fetch: fetchFn, reset };
}
