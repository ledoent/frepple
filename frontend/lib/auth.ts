// Obtain a short-lived JWT for the logged-in user from the same-origin Django
// app (resolved Q4: same-origin + JWT). The session cookie authorizes
// /api/token/, which mints the JWT used for websocket (subprotocol carrier) and
// REST (Authorization header) auth.
let cached: { token: string; exp: number } | null = null;

export async function getToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cached && cached.exp - 30 > now) return cached.token;
  const res = await fetch("/api/token/", { credentials: "include" });
  if (!res.ok) throw new Error(`token fetch failed: ${res.status}`);
  const data = (await res.json()) as { token: string; exp?: number };
  cached = { token: data.token, exp: data.exp ?? now + 3600 };
  return cached.token;
}

export function clearToken(): void {
  cached = null;
}
