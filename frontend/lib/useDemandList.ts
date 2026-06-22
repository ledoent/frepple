"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "./api";
import { HttpError, isAuthError } from "./errors";

// A demand the picker can select. Only the fields the picker shows.
export type DemandSummary = {
  name: string;
  item: string | null;
  customer: string | null;
  due: string | null;
  status: string | null;
};

type RawDemand = Record<string, unknown>;

// List demands for the pegging-screen picker via the input REST API. Returns the
// raw list; the page filters/typeaheads client-side (demo datasets are small).
export function useDemandList(scenario = ""): {
  demands: DemandSummary[];
  loading: boolean;
  error: string | null;
  authError: boolean;
} {
  const [demands, setDemands] = useState<DemandSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAuthError(false);

    async function load() {
      try {
        const prefix = scenario ? `/${scenario}` : "";
        const res = await authedFetch(`${prefix}/api/input/demand/?format=json`);
        if (!res.ok)
          throw new HttpError(res.status, `demand list failed: ${res.status}`);
        const json = (await res.json()) as RawDemand[];
        if (cancelled) return;
        const list: DemandSummary[] = (Array.isArray(json) ? json : []).map((d) => ({
          name: String(d.name ?? ""),
          item: (d.item as string) ?? null,
          customer: (d.customer as string) ?? null,
          due: (d.due as string) ?? null,
          status: (d.status as string) ?? null,
        }));
        setDemands(list);
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
  }, [scenario]);

  return { demands, loading, error, authError };
}
