// Typed network errors so callers can branch on auth failures without
// string-matching status codes out of error messages.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export class AuthError extends HttpError {
  constructor(status = 401, message?: string) {
    super(status, message ?? "authentication required");
    this.name = "AuthError";
  }
}

// True for "you are not signed in" failures (401/403), wherever they surfaced.
export function isAuthError(e: unknown): boolean {
  return (
    e instanceof AuthError ||
    (e instanceof HttpError && (e.status === 401 || e.status === 403))
  );
}
