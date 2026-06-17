"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "./api";
import { HttpError, isAuthError } from "./errors";
import { parsePegging, type Pegging } from "./pegging";

// Fetch + parse the demand-pegging Gantt for one demand in a scenario. Mirrors
// usePivotReport's contract (loading/error/authError/reload). `demand` empty =>
// idle (nothing selected yet). Tolerates a non-strict-JSON body (no plan yet).
export function usePegging(
  demand: string,
  scenario = "",
): {
  pegging: Pegging | null;
  loading: boolean;
  error: string | null;
  authError: boolean;
  reload: () => void;
} {
  const [pegging, setPegging] = useState<Pegging | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!demand) {
      setPegging(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAuthError(false);

    async function load() {
      try {
        const prefix = scenario ? `/${scenario}` : "";
        const path = `${prefix}/api/output/pegging/${encodeURIComponent(demand)}/?format=json`;
        const res = await authedFetch(path);
        if (!res.ok)
          throw new HttpError(res.status, `pegging fetch failed: ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* no plan computed yet -> empty tree */
        }
        setPegging(parsePegging(json as Parameters<typeof parsePegging>[0]));
      } catch (e) {
        if (cancelled) return;
        if (isAuthError(e)) setAuthError(true);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [demand, scenario, nonce]);

  return {
    pegging,
    loading,
    error,
    authError,
    reload: () => setNonce((n) => n + 1),
  };
}
