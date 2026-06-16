"use client";

import { useInventory } from "@/lib/useInventory";
import { INVENTORY_SHOWN, inventoryTitle } from "@/lib/inventory";
import { loginUrl } from "@/lib/session";
import type { PivotSeries, BucketMeta } from "@/lib/pivot";

// Phase 3 — Inventory/Buffer report. Read-only pivot of buffers x time buckets
// showing on-hand / safety / produced / consumed from the real plan
// (/api/output/inventory/, enriched PivotJSONStreamView). Reuses the design
// system + the generic pivot parser; no edit/save path.
const fmt = (v: number | null | undefined) =>
  v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1);

export default function InventoryPage() {
  const { series, buckets, loading, error, authError } = useInventory();

  return (
    <main>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Supply</div>
          <h1 className="h1">Inventory</h1>
          <p className="subtle">
            On-hand, safety stock and material flow per buffer across time
            buckets, from the latest plan.
          </p>
        </div>
      </div>

      {authError && (
        <div className="notice notice--auth" style={{ marginBottom: 18 }}>
          <span className="dot dot--fail" aria-hidden />
          <span>
            No active session. <a href={loginUrl("/inventory")}>Sign in</a> to
            load inventory data.
          </span>
        </div>
      )}
      {loading && <div className="empty">LOADING INVENTORY…</div>}
      {error && !authError && (
        <div className="notice notice--error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}
      {!loading && !error && series.length === 0 && (
        <div className="empty">No inventory buffers.</div>
      )}

      {series.length > 0 && (
        <div className="tablewrap">
          <table className="grid">
            <caption>
              Inventory by buffer over {buckets.length} time buckets
            </caption>
            <thead>
              <tr>
                <th scope="col">Buffer</th>
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
                <BufferRows key={s.key} s={s} buckets={buckets} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function BufferRows({
  s,
  buckets,
}: {
  s: PivotSeries;
  buckets: BucketMeta[];
}) {
  const title = inventoryTitle(s);
  return (
    <>
      {INVENTORY_SHOWN.map((row, ri) => (
        <tr key={row.measure}>
          {ri === 0 && (
            <th scope="rowgroup" className="series-cell" rowSpan={INVENTORY_SHOWN.length}>
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
