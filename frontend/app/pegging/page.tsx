"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginUrl } from "@/lib/session";
import { useDemandList } from "@/lib/useDemandList";
import { usePegging } from "@/lib/usePegging";
import PeggingGantt from "./PeggingGantt";

// Demand Pegging Gantt screen (Phase 3-D1). Pick a demand; see the supply-chain
// tree that pegs to it on a dated Gantt. Deep-linkable via ?demand=.
function PeggingScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("demand") ?? "";
  const [q, setQ] = useState("");

  const { demands, authError: listAuth } = useDemandList();
  const {
    pegging,
    loading,
    error,
    authError: pegAuth,
  } = usePegging(selected);
  const authError = listAuth || pegAuth;

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? demands.filter(
          (d) =>
            d.name.toLowerCase().includes(needle) ||
            (d.item ?? "").toLowerCase().includes(needle),
        )
      : demands;
    return list.slice(0, 50);
  }, [demands, q]);

  function pick(name: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (name) sp.set("demand", name);
    else sp.delete("demand");
    router.replace(`/pegging?${sp.toString()}`);
  }

  return (
    <main>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Plan analysis</div>
          <h1 className="h1">Demand pegging</h1>
          <p className="subtle">
            Trace the supply chain that pegs to a sales order — every
            operationplan feeding the delivery, on one dated timeline.
          </p>
        </div>
      </div>

      {authError && (
        <div className="notice notice--auth" style={{ marginBottom: 18 }}>
          <span className="dot dot--fail" aria-hidden />
          <span>
            No active session.{" "}
            <a href={loginUrl("/pegging")}>Sign in</a> to load pegging.
          </span>
        </div>
      )}

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <span className="panel-title">Demand</span>
          {selected && <span className="stat">{selected}</span>}
        </div>
        <div style={{ padding: "14px 16px" }}>
          <input
            className="cell-input"
            style={{ width: "100%", maxWidth: 360, marginBottom: 10 }}
            placeholder="Filter demands by name or item…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter demands"
          />
          <div className="picker" role="listbox" aria-label="Demands">
            {matches.map((d) => (
              <button
                key={d.name}
                role="option"
                aria-selected={d.name === selected}
                className={`picker-item${d.name === selected ? " is-selected" : ""}`}
                onClick={() => pick(d.name)}
              >
                <span className="picker-name">{d.name}</span>
                <span className="picker-meta">
                  {d.item ?? "—"}
                  {d.due ? ` · due ${d.due.slice(0, 10)}` : ""}
                </span>
              </button>
            ))}
            {!matches.length && (
              <span className="empty" style={{ border: "none" }}>
                NO DEMANDS MATCH
              </span>
            )}
          </div>
        </div>
      </section>

      {!selected && (
        <div className="empty">SELECT A DEMAND TO TRACE ITS PEGGING</div>
      )}
      {selected && loading && <div className="empty">LOADING PEGGING…</div>}
      {selected && error && !authError && (
        <div className="notice notice--error">
          <span className="dot dot--fail" aria-hidden />
          <span>Could not load pegging: {error}</span>
        </div>
      )}
      {selected && !loading && !error && pegging && (
        <PeggingGantt pegging={pegging} />
      )}
    </main>
  );
}

export default function PeggingPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="empty">LOADING…</div>}>
      <PeggingScreen />
    </Suspense>
  );
}
