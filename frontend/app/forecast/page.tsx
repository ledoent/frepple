"use client";

import { useMemo, useState } from "react";
import { useForecast } from "@/lib/useForecast";
import { saveBulkOverrides } from "@/lib/forecastSave";
import { applyFill, applyPercent, detectOutliers } from "@/lib/forecastEdit";
import { loginUrl } from "@/lib/session";
import {
  type ForecastSeries,
  type ForecastBucketMeta,
  type Measure,
} from "@/lib/forecast";
import { ForecastChart } from "./ForecastChart";

// Phase 1B Forecast Editor: a pivot of series x time buckets showing orders /
// baseline / override (editable) / net. Override edits persist to the engine
// (/forecast/detail/) which re-nets. Bulk fill / +-% across a row, outlier
// highlighting on the orders row. No top-300 cap.
const SHOWN: { measure: Measure; label: string; editable?: boolean }[] = [
  { measure: "orderstotal", label: "Orders" },
  { measure: "forecastbaseline", label: "Baseline" },
  { measure: "forecastoverride", label: "Override", editable: true },
  { measure: "forecastnet", label: "Net" },
];

const fmt = (v: number | null | undefined) =>
  v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1);

export default function ForecastPage() {
  const { series, buckets, loading, error, authError, reload } = useForecast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [charted, setCharted] = useState<string | null>(null);
  const chartedSeries = series.find((s) => s.key === charted) ?? null;

  const key = (s: string, b: string) => `${s} ${b}`;

  function setRowDraft(s: ForecastSeries, values: (number | null)[]) {
    setDraft((d) => {
      const next = { ...d };
      buckets.forEach((b, i) => {
        next[key(s.key, b.name)] = values[i] == null ? "" : String(values[i]);
      });
      return next;
    });
  }

  function currentOverrides(s: ForecastSeries): (number | null)[] {
    return buckets.map((b) => {
      const k = key(s.key, b.name);
      if (k in draft) {
        const raw = draft[k].trim();
        return raw === "" ? null : Number(raw);
      }
      const v = s.buckets[b.name]?.forecastoverride;
      return v == null ? null : v;
    });
  }

  async function saveRow(s: ForecastSeries) {
    const edits = buckets
      .map((b) => ({ bucket: b, k: key(s.key, b.name) }))
      .filter((e) => e.k in draft)
      .map((e) => {
        const raw = draft[e.k].trim();
        return { bucket: e.bucket, value: raw === "" ? null : Number(raw) };
      })
      .filter((e) => e.value === null || !Number.isNaN(e.value));
    if (edits.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveBulkOverrides(s, edits);
      setDraft((d) => {
        const next = { ...d };
        for (const b of buckets) delete next[key(s.key, b.name)];
        return next;
      });
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Demand planning</div>
          <h1 className="h1">Forecast</h1>
          <p className="subtle">
            Item / location / customer demand across time buckets. Edit the
            override row; the engine re-nets the forecast.
          </p>
        </div>
        {saving && (
          <span className="stat">
            <span className="dot dot--run" aria-hidden /> saving
          </span>
        )}
      </div>

      {authError && (
        <div className="notice notice--auth" style={{ marginBottom: 18 }}>
          <span className="dot dot--fail" aria-hidden />
          <span>
            No active session. <a href={loginUrl("/forecast")}>Sign in</a> to
            load forecast data.
          </span>
        </div>
      )}
      {loading && <div className="empty">LOADING FORECAST…</div>}
      {error && !authError && (
        <div className="notice notice--error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}
      {saveError && (
        <div className="notice notice--error" style={{ marginBottom: 18 }}>
          {saveError}
        </div>
      )}
      {!loading && !error && series.length === 0 && (
        <div className="empty">No forecast series.</div>
      )}

      {series.length > 0 && (
        <div className="tablewrap">
          <table className="grid">
            <caption>
              Forecast by item / location / customer over {buckets.length} time
              buckets
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
                  draft={draft}
                  setDraft={setDraft}
                  cellKey={key}
                  onBulkFill={(v) => setRowDraft(s, applyFill(v, buckets.length))}
                  onBulkPercent={(p) =>
                    setRowDraft(s, applyPercent(currentOverrides(s), p))
                  }
                  onSaveRow={() => saveRow(s)}
                  onChart={() => setCharted((c) => (c === s.key ? null : s.key))}
                  charted={charted === s.key}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {chartedSeries && <ForecastChart series={chartedSeries} buckets={buckets} />}
    </main>
  );
}

function SeriesRows({
  s,
  buckets,
  draft,
  setDraft,
  cellKey,
  onBulkFill,
  onBulkPercent,
  onSaveRow,
  onChart,
  charted,
}: {
  s: ForecastSeries;
  buckets: ForecastBucketMeta[];
  draft: Record<string, string>;
  setDraft: (fn: (d: Record<string, string>) => Record<string, string>) => void;
  cellKey: (s: string, b: string) => string;
  onBulkFill: (v: number | null) => void;
  onBulkPercent: (pct: number) => void;
  onSaveRow: () => void;
  onChart: () => void;
  charted: boolean;
}) {
  const title = useMemo(
    () =>
      [s.fields.item, s.fields.location, s.fields.customer]
        .filter(Boolean)
        .join(" / "),
    [s],
  );
  const outliers = useMemo(
    () =>
      detectOutliers(buckets.map((b) => s.buckets[b.name]?.orderstotal ?? null)),
    [s, buckets],
  );
  const [bulk, setBulk] = useState("");

  return (
    <>
      {SHOWN.map((row, ri) => (
        <tr key={row.measure}>
          {ri === 0 && (
            <th scope="rowgroup" className="series-cell" rowSpan={SHOWN.length}>
              <div className="series-name">
                <span>{title}</span>
                <button
                  type="button"
                  onClick={onChart}
                  aria-pressed={charted}
                  aria-label={`chart ${title}`}
                  className="btn btn-mini"
                  style={{ padding: "1px 7px" }}
                >
                  {charted ? "▣" : "▷"} chart
                </button>
              </div>
              <BulkControls
                value={bulk}
                setValue={setBulk}
                onFill={() => onBulkFill(bulk.trim() === "" ? null : Number(bulk))}
                onPercent={() => onBulkPercent(Number(bulk) || 0)}
                onSave={onSaveRow}
              />
            </th>
          )}
          <td className={`measure${row.editable ? " measure--override" : ""}`}>
            {row.label}
          </td>
          {buckets.map((b, bi) => {
            const v = s.buckets[b.name]?.[row.measure];
            const flagged = row.measure === "orderstotal" && outliers[bi];
            if (row.editable) {
              const k = cellKey(s.key, b.name);
              const shown = k in draft ? draft[k] : v == null ? "" : String(v);
              return (
                <td key={b.name} className="num">
                  <input
                    value={shown}
                    inputMode="decimal"
                    aria-label={`${title} ${row.label} ${b.name}`}
                    className="cell-input"
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [k]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSaveRow();
                    }}
                  />
                </td>
              );
            }
            return (
              <td
                key={b.name}
                title={flagged ? "outlier" : undefined}
                className={`num${flagged ? " cell--outlier" : ""}`}
              >
                {fmt(v)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function BulkControls({
  value,
  setValue,
  onFill,
  onPercent,
  onSave,
}: {
  value: string;
  setValue: (v: string) => void;
  onFill: () => void;
  onPercent: () => void;
  onSave: () => void;
}) {
  return (
    <div className="bulk">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        aria-label="bulk value or percent"
        placeholder="value / %"
      />
      <button
        type="button"
        onClick={onFill}
        className="btn btn-mini"
        title="Fill row"
      >
        Fill
      </button>
      <button
        type="button"
        onClick={onPercent}
        className="btn btn-mini"
        title="Apply percent"
      >
        ±%
      </button>
      <button type="button" onClick={onSave} className="btn btn-primary btn-mini">
        Save
      </button>
    </div>
  );
}
