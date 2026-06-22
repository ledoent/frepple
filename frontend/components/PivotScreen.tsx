"use client";

import { usePivotReport } from "@/lib/usePivotReport";
import { loginUrl } from "@/lib/session";
import type { PivotSeries, BucketMeta } from "@/lib/pivot";

// Generic read-only instrument grid for an enriched GridPivot OUTPUT report
// (inventory / demand / resource). A screen is just a config object; the table
// renders series x shown-measures x buckets. Reuses the design-system classes.
export type PivotScreenConfig = {
  endpoint: string; // e.g. "/api/output/demand/"
  keyField: string; // series identity row-field (e.g. "item", "resource")
  eyebrow: string;
  title: string; // h1 + accessible heading name
  subtitle: string;
  emptyText: string; // shown when the report has no series
  shown: { measure: string; label: string }[];
  titleOf: (s: PivotSeries) => string;
};

const fmt = (v: number | null | undefined) =>
  v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1);

export default function PivotScreen(cfg: PivotScreenConfig) {
  const { series, buckets, loading, error, authError } = usePivotReport(
    cfg.endpoint,
    cfg.keyField,
  );

  return (
    <main>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{cfg.eyebrow}</div>
          <h1 className="h1">{cfg.title}</h1>
          <p className="subtle">{cfg.subtitle}</p>
        </div>
      </div>

      {authError && (
        <div className="notice notice--auth" style={{ marginBottom: 18 }}>
          <span className="dot dot--fail" aria-hidden />
          <span>
            No active session.{" "}
            <a href={loginUrl(cfg.endpoint)}>Sign in</a> to load data.
          </span>
        </div>
      )}
      {loading && <div className="empty">LOADING…</div>}
      {error && !authError && (
        <div className="notice notice--error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}
      {!loading && !error && series.length === 0 && (
        <div className="empty">{cfg.emptyText}</div>
      )}

      {series.length > 0 && (
        <div className="tablewrap">
          <table className="grid">
            <caption>
              {cfg.title} by series over {buckets.length} time buckets
            </caption>
            <thead>
              <tr>
                <th scope="col">Series</th>
                <th scope="col">Measure</th>
                {buckets.map((b) => (
                  <th key={b.name} scope="col" className="num">
                    {b.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <SeriesRows
                  key={s.key}
                  s={s}
                  buckets={buckets}
                  shown={cfg.shown}
                  title={cfg.titleOf(s)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function SeriesRows({
  s,
  buckets,
  shown,
  title,
}: {
  s: PivotSeries;
  buckets: BucketMeta[];
  shown: { measure: string; label: string }[];
  title: string;
}) {
  return (
    <>
      {shown.map((row, ri) => (
        <tr key={row.measure}>
          {ri === 0 && (
            <th scope="rowgroup" className="series-cell" rowSpan={shown.length}>
              <div className="series-name">{title}</div>
            </th>
          )}
          <td className="measure">{row.label}</td>
          {buckets.map((b) => (
            <td key={b.name} className="num">
              {fmt(s.buckets[b.name]?.[row.measure])}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
