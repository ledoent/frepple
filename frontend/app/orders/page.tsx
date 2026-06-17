"use client";

import { useState } from "react";
import { loginUrl } from "@/lib/session";
import { useRecordList } from "@/lib/useRecordList";
import { ORDER_TABS } from "@/lib/orders";
import RecordTable from "@/components/RecordTable";

// Orders screen (Phase 3): manufacturing / purchase / distribution order
// summaries from the input REST API. One tab per order type; read-only here
// (inline editing is a follow-on — the pegging Gantt already does date edits).
export default function OrdersPage() {
  const [tabKey, setTabKey] = useState<string>(ORDER_TABS[0].key);
  const tab = ORDER_TABS.find((t) => t.key === tabKey) ?? ORDER_TABS[0];
  const { records, loading, error, authError } = useRecordList(tab.endpoint);

  return (
    <main>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Supply</div>
          <h1 className="h1">Orders</h1>
          <p className="subtle">
            Manufacturing, purchase and distribution orders the plan proposes or
            confirms — the supply side of the plan.
          </p>
        </div>
      </div>

      {authError && (
        <div className="notice notice--auth" style={{ marginBottom: 18 }}>
          <span className="dot dot--fail" aria-hidden />
          <span>
            No active session. <a href={loginUrl("/orders")}>Sign in</a> to load
            orders.
          </span>
        </div>
      )}

      <div className="tabbar" role="tablist" aria-label="Order type">
        {ORDER_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === tabKey}
            className={`tab${t.key === tabKey ? " is-active" : ""}`}
            onClick={() => setTabKey(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="empty">LOADING…</div>}
      {error && !authError && (
        <div className="notice notice--error">
          <span className="dot dot--fail" aria-hidden />
          <span>Could not load: {error}</span>
        </div>
      )}
      {!loading && !error && (
        <RecordTable
          columns={tab.columns}
          records={records}
          filterKeys={["reference", "item", "status"]}
          emptyText="NO ORDERS — NONE PLANNED YET"
        />
      )}
    </main>
  );
}
