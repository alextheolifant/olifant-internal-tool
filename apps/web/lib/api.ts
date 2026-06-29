import { getAccessToken, getRefreshToken, setTokens, clearSession } from './auth';

// Single in-flight refresh promise — prevents duplicate refresh requests
// when multiple concurrent calls all hit 401 at the same time.
let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return null;

      const { accessToken } = (await res.json()) as { accessToken: string };
      setTokens(accessToken);
      return accessToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getAccessToken();
  const { headers: extra, ...rest } = options;

  const headers = new Headers(extra as HeadersInit | undefined);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...rest, headers });
  if (res.status !== 401) return res;

  const newToken = await tryRefresh();

  if (!newToken) {
    clearSession();
    window.location.href = '/login';
    return res;
  }

  headers.set('Authorization', `Bearer ${newToken}`);
  return fetch(path, { ...rest, headers });
}
