// Read Django's `csrftoken` cookie so same-origin POSTs to Django (WSGI) views
// pass CsrfViewMiddleware. Django uses double-submit: the cookie is sent
// automatically with `credentials: "include"`, and the same value must be
// echoed in the `X-CSRFToken` header. The cookie is not HttpOnly, so JS can
// read it. Returns "" when unavailable (e.g. SSR), and callers omit the header.

// Pure parser (testable without a DOM). The `(?:^|;\s*)` anchor avoids matching
// a different cookie that merely ends in "csrftoken" (e.g. "xcsrftoken").
export function parseCsrf(cookie: string): string {
  const m = cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function csrfToken(): string {
  if (typeof document === "undefined") return "";
  return parseCsrf(document.cookie);
}
