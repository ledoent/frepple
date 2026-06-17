"use client";

import { useMemo, useState } from "react";
import { cellText, type Column, type RecordRow } from "@/lib/records";

// A generic, sortable-free flat record table for the Phase 3 list screens
// (problems/constraints, order summaries). Client-side text filter over the
// chosen columns; reuses the instrument-table design-system classes.
export default function RecordTable({
  columns,
  records,
  filterKeys,
  emptyText = "NO RECORDS",
}: {
  columns: Column[];
  records: RecordRow[];
  // Columns the search box matches against (defaults to all displayed columns).
  filterKeys?: string[];
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const keys = filterKeys ?? columns.map((c) => c.key);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((r) =>
      keys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle)),
    );
  }, [records, q, keys]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <input
          className="cell-input"
          style={{ width: "100%", maxWidth: 320 }}
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter records"
        />
        <span className="stat">
          {rows.length}
          {rows.length !== records.length ? ` / ${records.length}` : ""} rows
        </span>
      </div>

      {!rows.length ? (
        <div className="empty">{q ? "NO MATCHES" : emptyText}</div>
      ) : (
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={{ textAlign: c.align ?? "left" }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // Prefer the record's natural key (orders: reference, problems:
                // id) so filtering doesn't reshuffle index-keyed rows.
                <tr key={String(r.reference ?? r.id ?? i)}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={c.align === "right" ? "num" : undefined}
                      style={c.align ? { textAlign: c.align } : undefined}
                    >
                      {cellText(c, r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
