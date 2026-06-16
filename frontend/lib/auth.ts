// Obtain a short-lived JWT for the logged-in user from the same-origin Django
// app (resolved Q4: same-origin + JWT). The session cookie authorizes
// /api/token/, which mints the JWT used for websocket (subprotocol carrier) and
// REST (Authorization header) auth.
import { AuthError, HttpError } from "./errors";

let cached: { token: string; exp: number } | null = null;
// In-flight de-dup: several hooks mount together and all call getToken() on a
// cold cache; share the one request instead of firing N identical /api/token/.
let inflight: Promise<string> | null = null;

export async function getToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cached && cached.exp - 30 > now) return cached.token;
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch("/api/token/", { credentials: "include" });
      if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
      if (!res.ok)
        throw new HttpError(res.status, `token fetch failed: ${res.status}`);
      const data = (await res.json()) as { token: string; exp?: number };
      cached = { token: data.token, exp: data.exp ?? now + 3600 };
      return cached.token;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function clearToken(): void {
  cached = null;
}
