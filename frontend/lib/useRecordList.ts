"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "./api";
import { HttpError, isAuthError } from "./errors";
import { parseRecords, type RecordRow } from "./records";

// Fetch a flat record list (problem/constraint output reports, or DRF order
// lists) for a scenario. Mirrors usePivotReport's loading/error/authError/reload
// contract. Tolerant of an empty/non-strict-JSON body (no plan computed yet).
export function useRecordList(
  endpoint: string,
  scenario = "",
): {
  records: RecordRow[];
  loading: boolean;
  error: string | null;
  authError: boolean;
  reload: () => void;
} {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAuthError(false);

    async function load() {
      try {
        const prefix = scenario ? `/${scenario}` : "";
        const sep = endpoint.includes("?") ? "&" : "?";
        const res = await authedFetch(`${prefix}${endpoint}${sep}format=json`);
        if (!res.ok)
          throw new HttpError(res.status, `${endpoint} fetch failed: ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* empty/no-plan body -> [] */
        }
        setRecords(parseRecords(json as Parameters<typeof parseRecords>[0]));
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
  }, [endpoint, scenario, nonce]);

  return {
    records,
    loading,
    error,
    authError,
    reload: () => setNonce((n) => n + 1),
  };
}
