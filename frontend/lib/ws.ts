// Shared websocket helpers for the live screens.
import { getToken } from "./auth";

export function wsUrl(path: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

// Open an authenticated websocket. Browsers cannot set request headers on a
// WebSocket, so the JWT is carried in the Sec-WebSocket-Protocol subprotocol as
// ["bearer", "<jwt>"] - which TokenMiddleware (asgi.py) reads server-side.
export async function openAuthedSocket(path: string): Promise<WebSocket> {
  const token = await getToken();
  return new WebSocket(wsUrl(path), ["bearer", token]);
}

export function scenarioPrefix(scenario: string | undefined): string {
  return scenario ? `/${scenario}` : "";
}

// Parse a frePPLe task status ("0%".."100%", "Done", "Failed", "Waiting") into a
// 0-100 progress number plus a coarse state for the UI.
export type TaskState = "waiting" | "running" | "done" | "failed" | "canceled";

export function parseStatus(status: string | null): {
  percent: number;
  state: TaskState;
} {
  if (!status) return { percent: 0, state: "waiting" };
  const s = status.trim();
  if (s.endsWith("%")) {
    const pct = Math.max(0, Math.min(100, parseFloat(s)));
    return { percent: isNaN(pct) ? 0 : pct, state: "running" };
  }
  const lower = s.toLowerCase();
  if (lower === "done") return { percent: 100, state: "done" };
  if (lower === "failed") return { percent: 100, state: "failed" };
  if (lower === "canceled") return { percent: 100, state: "canceled" };
  return { percent: 0, state: "waiting" };
}
