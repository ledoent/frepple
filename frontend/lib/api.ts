// Same-origin authed fetch shared by the REST/data-layer calls. Injects the
// Bearer JWT and cookies, and (for mutations) the Django double-submit CSRF
// header. Throws AuthError on a 401/403 response so callers can prompt sign-in;
// returns the (redirect-followed) Response otherwise — the caller inspects
// res.ok / res.url for everything else.
import { getToken } from "./auth";
import { csrfToken } from "./csrf";
import { AuthError } from "./errors";

export async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const csrf = csrfToken();
    if (csrf) headers.set("X-CSRFToken", csrf);
  }
  const res = await fetch(path, { ...init, headers, credentials: "include" });
  if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
  return res;
}
