// Read Django's `csrftoken` cookie so same-origin POSTs to Django (WSGI) views
// pass CsrfViewMiddleware. Django uses double-submit: the cookie is sent
// automatically with `credentials: "include"`, and the same value must be
// echoed in the `X-CSRFToken` header. The cookie is not HttpOnly, so JS can
// read it. Returns "" when unavailable (e.g. SSR), and callers omit the header.
export function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
