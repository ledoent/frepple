"use client";

import { useState } from "react";
import { loginUrl } from "@/lib/session";
import { useRecordList } from "@/lib/useRecordList";
import { PROBLEM_COLUMNS, PROBLEM_TABS } from "@/lib/problems";
import RecordTable from "@/components/RecordTable";

// Problems / Constraints screen (Phase 3): the violation lists the engine flags —
// late demands, capacity overloads, material shortages, etc. Two tabs over the
// same flat columns.
export default function ProblemsPage() {
  const [tabKey, setTabKey] = useState<string>(PROBLEM_TABS[0].key);
  const tab = PROBLEM_TABS.find((t) => t.key === tabKey) ?? PROBLEM_TABS[0];
  const { records, loading, error, authError } = useRecordList(tab.endpoint);

  return (
    <main>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Plan analysis</div>
          <h1 className="h1">Problems</h1>
          <p className="subtle">
            Constraint violations and plan issues the engine flagged — what to fix,
            and when it bites.
          </p>
        </div>
      </div>

      {authError && (
        <div className="notice notice--auth" style={{ marginBottom: 18 }}>
          <span className="dot dot--fail" aria-hidden />
          <span>
            No active session. <a href={loginUrl("/problems")}>Sign in</a> to load
            problems.
          </span>
        </div>
      )}

      <div className="tabbar" role="tablist" aria-label="Problem kind">
        {PROBLEM_TABS.map((t) => (
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
          columns={PROBLEM_COLUMNS}
          records={records}
          emptyText="NO PROBLEMS — A CLEAN PLAN, OR NONE COMPUTED YET"
        />
      )}
    </main>
  );
}
