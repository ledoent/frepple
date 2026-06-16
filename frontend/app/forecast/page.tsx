"use client";

import { useMemo, useState } from "react";
import { useForecast } from "@/lib/useForecast";
import { saveBulkOverrides } from "@/lib/forecastSave";
import { applyFill, applyPercent, detectOutliers } from "@/lib/forecastEdit";
import {
  type ForecastSeries,
  type ForecastBucketMeta,
  type Measure,
} from "@/lib/forecast";
import { ForecastChart } from "./ForecastChart";

// Phase 1B Forecast Editor: a pivot of series x time buckets showing orders /
// baseline / override (editable) / net. Override edits persist to the engine
// (/forecast/detail/) which re-nets. Bulk fill / +-% across a row, and outlier
// highlighting on the orders row. No top-300 cap.
const SHOWN: { measure: Measure; label: string; editable?: boolean }[] = [
  { measure: "orderstotal", label: "Orders" },
  { measure: "forecastbaseline", label: "Baseline" },
  { measure: "forecastoverride", label: "Override", editable: true },
  { measure: "forecastnet", label: "Net" },
];

export default function ForecastPage() {
  const { series, buckets, loading, error, reload } = useForecast();
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
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>
        Forecast{" "}
        {saving && (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>saving…</span>
        )}
      </h1>
      {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      {error && <p style={{ color: "var(--fail)" }}>{error}</p>}
      {saveError && <p style={{ color: "var(--fail)" }}>{saveError}</p>}
      {!loading && !error && series.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No forecast series.</p>
      )}
      {series.length > 0 && (
        <div style={{ overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
            <caption style={{ textAlign: "left", padding: "0 0 8px" }}>
              Forecast by item / location / customer over time buckets
            </caption>
            <thead>
              <tr>
                <th scope="col" style={th}>
                  Series
                </th>
                <th scope="col" style={th}>
                  Measure
                </th>
                {buckets.map((b) => (
                  <th
                    key={b.name}
                    scope="col"
                    style={{ ...th, textAlign: "right" }}
                  >
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
                  onChart={() =>
                    setCharted((c) => (c === s.key ? null : s.key))
                  }
                  charted={charted === s.key}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {chartedSeries && (
        <ForecastChart series={chartedSeries} buckets={buckets} />
      )}
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
  // Outliers on the orders history, for highlighting.
  const outliers = useMemo(
    () => detectOutliers(buckets.map((b) => s.buckets[b.name]?.orderstotal ?? null)),
    [s, buckets],
  );
  const [bulk, setBulk] = useState("");

  return (
    <>
      {SHOWN.map((row, ri) => (
        <tr key={row.measure}>
          {ri === 0 && (
            <th scope="rowgroup" style={{ ...td, fontWeight: 600 }} rowSpan={SHOWN.length}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span>{title}</span>
                <button
                  type="button"
                  onClick={onChart}
                  aria-pressed={charted}
                  aria-label={`chart ${title}`}
                  style={{ ...miniBtn, padding: "0 6px" }}
                >
                  📈
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
          <td style={{ ...td, color: "var(--muted)" }}>{row.label}</td>
          {buckets.map((b, bi) => {
            const v = s.buckets[b.name]?.[row.measure];
            const flagged = row.measure === "orderstotal" && outliers[bi];
            if (row.editable) {
              const k = cellKey(s.key, b.name);
              const shown = k in draft ? draft[k] : v == null ? "" : String(v);
              return (
                <td key={b.name} style={{ ...td, textAlign: "right" }}>
                  <input
                    value={shown}
                    inputMode="decimal"
                    aria-label={`${title} ${row.label} ${b.name}`}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [k]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSaveRow();
                    }}
                    style={input}
                  />
                </td>
              );
            }
            return (
              <td
                key={b.name}
                title={flagged ? "outlier" : undefined}
                style={{
                  ...td,
                  textAlign: "right",
                  ...(flagged
                    ? { background: "rgba(239,68,68,0.18)", fontWeight: 600 }
                    : null),
                }}
              >
                {v == null ? "" : v}
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
    <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        aria-label="bulk value or percent"
        placeholder="value / %"
        style={{ ...input, width: 70 }}
      />
      <button type="button" onClick={onFill} style={miniBtn} title="Fill row">
        Fill
      </button>
      <button type="button" onClick={onPercent} style={miniBtn} title="Apply percent">
        ±%
      </button>
      <button type="button" onClick={onSave} style={{ ...miniBtn, ...saveBtn }}>
        Save
      </button>
    </div>
  );
}

const th: React.CSSProperties = {
  border: "1px solid var(--border)",
  padding: "4px 8px",
  position: "sticky",
  top: 0,
  background: "var(--panel)",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  border: "1px solid var(--border)",
  padding: "2px 8px",
  whiteSpace: "nowrap",
};
const input: React.CSSProperties = {
  width: 64,
  textAlign: "right",
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "2px 4px",
};
const miniBtn: React.CSSProperties = {
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "2px 6px",
  cursor: "pointer",
  fontSize: 12,
};
const saveBtn: React.CSSProperties = {
  background: "var(--accent)",
  color: "white",
  border: "none",
};
