"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "./api";
import { HttpError, isAuthError } from "./errors";
import {
  parseForecast,
  type ForecastSeries,
  type ForecastBucketMeta,
} from "./forecast";

// Read the forecast OUTPUT report for a scenario (optionally filtered to one
// forecast `name`) and pivot it into editable series. Same-origin fetch with a
// Bearer JWT (the output endpoint also accepts the session cookie).
export function useForecast(
  scenario = "",
  name?: string,
): {
  series: ForecastSeries[];
  buckets: ForecastBucketMeta[];
  loading: boolean;
  error: string | null;
  authError: boolean;
  reload: () => void;
} {
  const [series, setSeries] = useState<ForecastSeries[]>([]);
  const [buckets, setBuckets] = useState<ForecastBucketMeta[]>([]);
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
        const qs = name ? `?name=${encodeURIComponent(name)}` : "";
        const res = await authedFetch(`${prefix}/api/output/forecast/${qs}`);
        if (!res.ok)
          throw new HttpError(res.status, `forecast fetch failed: ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          // An uncomputed/empty forecast: frePPLe's empty-grid report emits
          // non-strict JSON. Treat it as no series rather than an error.
          setSeries([]);
          setBuckets([]);
          return;
        }
        const parsed = parseForecast(json as Parameters<typeof parseForecast>[0]);
        setSeries(parsed.series);
        setBuckets(parsed.buckets);
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
  }, [scenario, name, nonce]);

  return {
    series,
    buckets,
    loading,
    error,
    authError,
    reload: () => setNonce((n) => n + 1),
  };
}
