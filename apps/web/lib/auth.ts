export interface JwtUser {
  id: string;
  email: string;
  role: string;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('refresh_token');
}

export function setTokens(accessToken: string, refreshToken?: string) {
  localStorage.setItem('access_token', accessToken);
  if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
  const maxAge = 30 * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  document.cookie = `olifant_session=1; path=/; max-age=${maxAge}; SameSite=Strict${secure}`;
}

export function clearSession() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  document.cookie = 'olifant_session=; path=/; max-age=0; SameSite=Strict';
}

export function parseAccessToken(token: string): JwtUser | null {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
