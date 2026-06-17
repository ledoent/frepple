"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAuthError } from "@/lib/errors";
import { loginUrl } from "@/lib/session";
import { useDemandList } from "@/lib/useDemandList";
import { usePegging } from "@/lib/usePegging";
import { useReplan } from "@/lib/useReplan";
import { patchReschedule } from "@/lib/reschedule";
import { useToast } from "@/components/Toast";
import { downstreamChain, type PeggingBar } from "@/lib/pegging";
import PeggingGantt from "./PeggingGantt";

// Demand Pegging Gantt screen (Phase 3-D1 read / D2 reschedule / D3 re-plan loop).
// Pick a demand; trace the supply chain on a dated Gantt; drag a bar to
// reschedule the operationplan; re-plan in place to recompute the peg.
function PeggingScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("demand") ?? "";
  const [q, setQ] = useState("");
  // After a reschedule the peg is stale; `affected` are the downstream rows whose
  // timing may shift (highlighted until a re-plan recomputes the real result).
  const [stale, setStale] = useState(false);
  const [affected, setAffected] = useState<Set<string>>(new Set());
  const toast = useToast();

  const { demands, authError: listAuth } = useDemandList();
  const {
    pegging,
    loading,
    error,
    authError: pegAuth,
    reload,
  } = usePegging(selected);
  const { replan, running: replanning } = useReplan();
  const authError = listAuth || pegAuth;

  // A reschedule persists dates but does NOT recompute the peg — only a re-plan
  // does. Clear the stale hint + affected highlight whenever the demand changes.
  useEffect(() => {
    setStale(false);
    setAffected(new Set());
  }, [selected]);

  // Drag-drop reschedule: PATCH the operationplan's dates, flag the downstream
  // chain (D3), then reload so the Gantt reflects the persisted state. On failure
  // reload too, snapping the bar back; rethrow so the bar clears its pending UI.
  async function handleReschedule(
    bar: PeggingBar,
    rowId: string,
    startdate: string,
    enddate: string,
  ) {
    try {
      await patchReschedule({
        type: bar.type,
        reference: bar.reference,
        startdate,
        enddate,
      });
      toast("ok", "Rescheduled", `${bar.type} ${bar.reference} → ${startdate.slice(0, 10)}.`);
      const rows = pegging?.rows ?? [];
      setAffected(downstreamChain(rows, rows.findIndex((r) => r.id === rowId)));
      setStale(true);
      reload();
    } catch (e) {
      if (isAuthError(e)) {
        toast("error", "Sign-in required", "Sign in to reschedule.");
      } else {
        toast("error", "Reschedule failed", e instanceof Error ? e.message : String(e));
      }
      reload();
      throw e;
    }
  }

  // The re-plan loop: run the engine, then re-fetch the (now authoritative)
  // pegging and clear the stale/affected hints.
  async function handleReplan() {
    try {
      await replan();
      toast("ok", "Re-planned", "Pegging refreshed from the engine.");
      setStale(false);
      setAffected(new Set());
      reload();
    } catch (e) {
      if (isAuthError(e)) {
        toast("error", "Sign-in required", "Sign in to re-plan.");
      } else {
        toast("error", "Re-plan failed", e instanceof Error ? e.message : String(e));
      }
    }
  }

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
      {stale && (
        <div
          className="notice notice--auth"
          style={{
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span className="dot dot--run" aria-hidden />
          <span style={{ flex: 1 }}>
            Dates saved. Highlighted steps may shift — the peg recomputes when you
            re-plan.
          </span>
          <button
            className="btn btn-primary btn-mini"
            onClick={handleReplan}
            disabled={replanning}
          >
            {replanning ? "Re-planning…" : "Re-plan now"}
          </button>
        </div>
      )}
      {selected && !loading && !error && pegging && (
        <PeggingGantt
          pegging={pegging}
          onReschedule={handleReschedule}
          affected={affected}
        />
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
