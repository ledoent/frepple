// Session helpers. The SPA is authorized by the Django session cookie; /api/token/
// mints a short-lived JWT for it. We reuse that endpoint to answer "is there a
// session, and who is it?" — the JWT payload carries the username. When there is
// no session the screens can't load data, so the UI sends the user to the
// (same-origin) Django login page and back.

export type Session = { user: string; exp: number };

function decodeClaims(token: string): { user?: string; exp?: number } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as { user?: string; exp?: number };
  } catch {
    return {};
  }
}

// Returns the session, or null when unauthenticated (401). Throws only on a
// genuine network error so callers can distinguish "logged out" from "offline".
export async function fetchSession(): Promise<Session | null> {
  const res = await fetch("/api/token/", { credentials: "include" });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`session check failed: ${res.status}`);
  const data = (await res.json()) as { token: string; exp?: number };
  const claims = decodeClaims(data.token);
  return { user: claims.user ?? "user", exp: data.exp ?? claims.exp ?? 0 };
}

// Same-origin Django login, returning to `next` (defaults to the current path).
export function loginUrl(next?: string): string {
  const dest =
    next ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  return `/data/login/?next=${encodeURIComponent(dest)}`;
}

export function logoutUrl(): string {
  return "/data/logout/";
}
