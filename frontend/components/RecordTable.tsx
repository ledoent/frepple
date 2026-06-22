"use client";

import { useMemo, useState } from "react";
import { cellText, type Column, type RecordRow } from "@/lib/records";

// Editing hooks the table to a persistence layer. The page provides save/delete;
// the table owns the per-row edit/delete UI + optimistic state.
export type EditConfig = {
  rowKey: string; // the field identifying a row (e.g. "reference")
  canEdit?: (row: RecordRow) => boolean; // locked rows are read-only
  onSave: (row: RecordRow, changes: Record<string, unknown>) => Promise<void>;
  onDelete: (row: RecordRow) => Promise<void>;
};

function pillClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "confirmed" || s === "approved") return "pill pill--ok";
  if (s === "completed" || s === "closed") return "pill pill--done";
  if (s === "proposed") return "pill pill--run";
  return "pill";
}

// A generic flat record table (problems/constraints, order summaries). Client-side
// filter; optional inline edit/delete when `edit` is supplied. Reuses the
// instrument-table design-system classes.
export default function RecordTable({
  columns,
  records,
  filterKeys,
  edit,
  emptyText = "NO RECORDS",
}: {
  columns: Column[];
  records: RecordRow[];
  filterKeys?: string[];
  edit?: EditConfig;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const keys = filterKeys ?? columns.map((c) => c.key);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((r) =>
      keys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle)),
    );
  }, [records, q, keys]);

  function startEdit(id: string) {
    setConfirmDel(null);
    setDraft({});
    setEditing(id);
  }
  function cancelEdit() {
    setEditing(null);
    setDraft({});
  }
  async function save(row: RecordRow, id: string) {
    if (!edit || !Object.keys(draft).length) return cancelEdit();
    setPending(id);
    try {
      await edit.onSave(row, draft); // page reloads on success -> fresh records
      cancelEdit();
    } catch {
      /* page surfaces the error; keep the row in edit mode to retry */
    } finally {
      setPending(null);
    }
  }
  async function del(row: RecordRow, id: string) {
    if (!edit) return;
    setPending(id);
    try {
      await edit.onDelete(row);
      setConfirmDel(null);
    } catch {
      /* page surfaces the error; keep the confirm to retry */
    } finally {
      setPending(null);
    }
  }

  function editCell(c: Column, row: RecordRow) {
    const cur = draft[c.key] ?? row[c.key];
    const set = (v: unknown) => setDraft((d) => ({ ...d, [c.key]: v }));
    if (c.edit === "select") {
      return (
        <select
          className="cell-input"
          value={String(cur ?? "")}
          onChange={(e) => set(e.target.value)}
          aria-label={c.label}
        >
          {(c.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        className="cell-input"
        type={c.edit === "number" ? "number" : c.edit === "date" ? "date" : "text"}
        value={c.edit === "date" ? String(cur ?? "").slice(0, 10) : String(cur ?? "")}
        onChange={(e) => set(e.target.value)}
        aria-label={c.label}
      />
    );
  }

  return (
    <>
      <div className="record-toolbar">
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
                {edit && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const id = String(r[edit?.rowKey ?? "reference"] ?? r.id ?? i);
                const isEditing = editing === id;
                const editable = edit ? (edit.canEdit?.(r) ?? true) : false;
                const busy = pending === id;
                return (
                  <tr
                    key={id}
                    className={
                      (isEditing ? "grid-row--editing" : "") +
                      (busy ? " grid-row--busy" : "")
                    }
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={c.align === "right" ? "num" : undefined}
                        style={c.align ? { textAlign: c.align } : undefined}
                      >
                        {isEditing && c.edit ? (
                          editCell(c, r)
                        ) : c.pill ? (
                          <span className={pillClass(String(r[c.key] ?? ""))}>
                            {cellText(c, r)}
                          </span>
                        ) : (
                          cellText(c, r)
                        )}
                      </td>
                    ))}
                    {edit && (
                      <td className="row-actions">
                        {isEditing ? (
                          <>
                            <button
                              className="rowbtn rowbtn--ok"
                              onClick={() => save(r, id)}
                              disabled={busy}
                            >
                              Save
                            </button>
                            <button className="rowbtn" onClick={cancelEdit} disabled={busy}>
                              Cancel
                            </button>
                          </>
                        ) : confirmDel === id ? (
                          <>
                            <span className="row-confirm">Delete?</span>
                            <button
                              className="rowbtn rowbtn--danger"
                              onClick={() => del(r, id)}
                              disabled={busy}
                            >
                              Yes
                            </button>
                            <button
                              className="rowbtn"
                              onClick={() => setConfirmDel(null)}
                              disabled={busy}
                            >
                              No
                            </button>
                          </>
                        ) : editable ? (
                          <>
                            <button
                              className="rowbtn"
                              onClick={() => startEdit(id)}
                              aria-label={`Edit ${id}`}
                            >
                              Edit
                            </button>
                            <button
                              className="rowbtn rowbtn--danger"
                              onClick={() => setConfirmDel(id)}
                              aria-label={`Delete ${id}`}
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <span className="row-locked" title="executed — read-only">
                            locked
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
