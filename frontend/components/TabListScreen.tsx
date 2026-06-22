"use client";

import { useId, useState } from "react";
import { isAuthError } from "@/lib/errors";
import { loginUrl } from "@/lib/session";
import { useRecordList } from "@/lib/useRecordList";
import { useToast } from "@/components/Toast";
import type { Column, RecordRow } from "@/lib/records";
import RecordTable from "@/components/RecordTable";

// Inline-edit wiring for an editable list (orders): persist a change / a delete
// against the active tab's endpoint. The screen adds toast + reload around it.
export type EditableConfig = {
  rowKey: string;
  canEdit?: (row: RecordRow) => boolean;
  save: (endpoint: string, row: RecordRow, changes: Record<string, unknown>) => Promise<void>;
  remove: (endpoint: string, row: RecordRow) => Promise<void>;
};

export type ListTab = {
  key: string;
  label: string;
  endpoint: string;
  // Per-tab columns (orders); falls back to the screen-level `columns` (problems).
  columns?: Column[];
};

// Shared chrome for the Phase 3 flat-list screens (Problems/Constraints, Orders):
// page header + a tabbed record table over one endpoint per tab. Owns the
// tab/tabpanel a11y wiring (roles, aria-controls, arrow-key nav) and the
// auth/loading/error states, so the screens stay thin config.
export default function TabListScreen({
  eyebrow,
  title,
  subtitle,
  path,
  tabs,
  columns,
  filterKeys,
  editable,
  emptyText,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  path: string; // for the sign-in redirect
  tabs: ListTab[];
  columns?: Column[]; // default columns when a tab doesn't carry its own
  filterKeys?: string[];
  editable?: EditableConfig; // present => inline edit/delete
  emptyText?: string;
}) {
  const [tabKey, setTabKey] = useState(tabs[0].key);
  const tab = tabs.find((t) => t.key === tabKey) ?? tabs[0];
  const cols = tab.columns ?? columns ?? [];
  const baseId = useId();
  const toast = useToast();

  const { records, loading, error, authError, reload } = useRecordList(tab.endpoint);

  // Wrap the page's persist functions with toast + reload. Rethrow so the table
  // keeps the row open for a retry on failure.
  const edit = editable
    ? {
        rowKey: editable.rowKey,
        canEdit: editable.canEdit,
        onSave: async (row: RecordRow, changes: Record<string, unknown>) => {
          try {
            await editable.save(tab.endpoint, row, changes);
            toast("ok", "Saved", `${row[editable.rowKey]} updated.`);
            reload();
          } catch (e) {
            errToast(e);
            throw e;
          }
        },
        onDelete: async (row: RecordRow) => {
          try {
            await editable.remove(tab.endpoint, row);
            toast("ok", "Deleted", `${row[editable.rowKey]} removed.`);
            reload();
          } catch (e) {
            errToast(e);
            throw e;
          }
        },
      }
    : undefined;

  function errToast(e: unknown) {
    if (isAuthError(e)) toast("error", "Sign-in required", "Sign in to edit.");
    else toast("error", "Save failed", e instanceof Error ? e.message : String(e));
  }

  // Arrow-key tab navigation (the ARIA tabs pattern).
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    setTabKey(tabs[next].key);
  }

  return (
    <main>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="h1">{title}</h1>
          <p className="subtle">{subtitle}</p>
        </div>
      </div>

      {authError && (
        <div className="notice notice--auth" style={{ marginBottom: 18 }}>
          <span className="dot dot--fail" aria-hidden />
          <span>
            No active session. <a href={loginUrl(path)}>Sign in</a> to load data.
          </span>
        </div>
      )}

      <div className="tabbar" role="tablist" aria-label={title}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            id={`${baseId}-tab-${t.key}`}
            role="tab"
            aria-selected={t.key === tabKey}
            aria-controls={`${baseId}-panel`}
            tabIndex={t.key === tabKey ? 0 : -1}
            className={`tab${t.key === tabKey ? " is-active" : ""}`}
            onClick={() => setTabKey(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${tabKey}`}
      >
        {loading && <div className="empty">LOADING…</div>}
        {error && !authError && (
          <div className="notice notice--error">
            <span className="dot dot--fail" aria-hidden />
            <span>Could not load: {error}</span>
          </div>
        )}
        {!loading && !error && (
          <RecordTable
            columns={cols}
            records={records}
            filterKeys={filterKeys}
            edit={edit}
            emptyText={emptyText}
          />
        )}
      </div>
    </main>
  );
}
