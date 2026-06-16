"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "./api";
import { HttpError, isAuthError } from "./errors";
import { parsePivot, type PivotSeries, type BucketMeta } from "./pivot";
import { INVENTORY_KEY_FIELD } from "./inventory";

// Read the inventory/buffer OUTPUT report for a scenario and pivot it into
// series. Same shape/handling as useForecast (authedFetch + parse, tolerant of
// an empty/non-strict-JSON body when no plan exists yet).
export function useInventory(scenario = ""): {
  series: PivotSeries[];
  buckets: BucketMeta[];
  measures: string[];
  loading: boolean;
  error: string | null;
  authError: boolean;
  reload: () => void;
} {
  const [series, setSeries] = useState<PivotSeries[]>([]);
  const [buckets, setBuckets] = useState<BucketMeta[]>([]);
  const [measures, setMeasures] = useState<string[]>([]);
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
        const res = await authedFetch(`${prefix}/api/output/inventory/`);
        if (!res.ok)
          throw new HttpError(res.status, `inventory fetch failed: ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          // No plan computed yet: the empty-grid report emits non-strict JSON.
          setSeries([]);
          setBuckets([]);
          setMeasures([]);
          return;
        }
        const parsed = parsePivot(json as Parameters<typeof parsePivot>[0], {
          keyField: INVENTORY_KEY_FIELD,
        });
        setSeries(parsed.series);
        setBuckets(parsed.buckets);
        setMeasures(parsed.measures);
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
  }, [scenario, nonce]);

  return {
    series,
    buckets,
    measures,
    loading,
    error,
    authError,
    reload: () => setNonce((n) => n + 1),
  };
}
