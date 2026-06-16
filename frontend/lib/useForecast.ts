"use client";

import { useEffect, useState } from "react";
import { getToken } from "./auth";
import {
  pivotForecast,
  bucketNames,
  MEASURES,
  type ForecastSeries,
} from "./forecast";

// Read the forecast OUTPUT report for a scenario (optionally filtered to one
// forecast `name`) and pivot it into editable series. Same-origin fetch with a
// Bearer JWT (the output endpoint also accepts the session cookie).
export function useForecast(
  scenario = "",
  name?: string,
): {
  series: ForecastSeries[];
  buckets: string[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [series, setSeries] = useState<ForecastSeries[]>([]);
  const [buckets, setBuckets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const token = await getToken();
        const prefix = scenario ? `/${scenario}` : "";
        const qs = name ? `?name=${encodeURIComponent(name)}` : "";
        const res = await fetch(`${prefix}/api/output/forecast/${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        });
        if (!res.ok) throw new Error(`forecast fetch failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const s = pivotForecast(data, MEASURES);
        setSeries(s);
        setBuckets(bucketNames(s));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [scenario, name, nonce]);

  return { series, buckets, loading, error, reload: () => setNonce((n) => n + 1) };
}
