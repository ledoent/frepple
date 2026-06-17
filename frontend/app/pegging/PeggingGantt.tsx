"use client";

import { useRef, useState } from "react";
import {
  axisTicks,
  fractionOf,
  parseEngineDate,
  type Pegging,
  type PeggingBar,
} from "@/lib/pegging";
import { isReschedulable, shiftEngineDate } from "@/lib/reschedule";

// Demand-pegging Gantt. D1 rendered it read-only; D2 adds pointer-drag
// rescheduling: drag a bar horizontally to shift its start/end by the dragged
// time delta, then the page PATCHes the operationplan's dates. Bars are
// absolutely positioned by date fraction (HTML/CSS, not SVG) so the drag is a
// straight px->fraction->time mapping over the lane width.

const STATUS_CLASS: Record<string, string> = {
  proposed: "gantt-bar--proposed",
  approved: "gantt-bar--firm",
  confirmed: "gantt-bar--firm",
  completed: "gantt-bar--done",
  closed: "gantt-bar--done",
};

// Below this drag distance (fraction of the lane) we treat the gesture as a
// click, not a reschedule.
const DRAG_THRESHOLD = 0.004;

function barTooltip(b: PeggingBar, editable: boolean): string {
  const dates =
    b.start && b.end && b.start !== b.end
      ? `${b.start} → ${b.end}`
      : b.start || b.end || "no dates";
  const risk = b.criticality > 0 ? `\ncriticality ${b.criticality}` : "";
  const hint = editable ? "\n(drag to reschedule)" : "";
  return `${b.type} ${b.reference}\n${b.operation}\nqty ${b.quantity}\n${b.status} · ${dates}${risk}${hint}`;
}

export default function PeggingGantt({
  pegging,
  onReschedule,
  affected,
}: {
  pegging: Pegging;
  // Provided => bars are draggable; resolves once the PATCH persisted (the page
  // then reloads), rejects on failure (the bar snaps back to server state). The
  // `rowId` lets the page flag the affected downstream chain (D3).
  onReschedule?: (
    bar: PeggingBar,
    rowId: string,
    startdate: string,
    enddate: string,
  ) => Promise<void>;
  // Row ids whose timing depends on a just-rescheduled op (D3) — highlighted as
  // "impact pending" until a re-plan recomputes the peg.
  affected?: Set<string>;
}) {
  const { window, rows } = pegging;
  const startMs = parseEngineDate(window.start);
  const endMs = parseEngineDate(window.end);
  const spanMs = endMs - startMs;
  const ticks = axisTicks(window);
  const dueFrac = fractionOf(window.due, startMs, endMs);
  const nowFrac = fractionOf(window.current, startMs, endMs);

  // Live drag offset for the bar being dragged (keyed by operationplan ref), and
  // the ref currently mid-PATCH (rendered pending). dragInfo holds the immutable
  // gesture context so move/up don't depend on render state.
  const [drag, setDrag] = useState<{ ref: string; deltaFrac: number } | null>(null);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const dragInfo = useRef<{
    startX: number;
    laneW: number;
    baseLeft: number;
    bar: PeggingBar;
    rowId: string;
  } | null>(null);

  if (!rows.length) {
    return (
      <div className="empty">
        NO PEGGING — THIS DEMAND IS UNPLANNED. RUN A PLAN FIRST.
      </div>
    );
  }

  function onPointerDown(
    e: React.PointerEvent<HTMLSpanElement>,
    bar: PeggingBar,
    baseLeft: number,
    rowId: string,
  ) {
    const lane = e.currentTarget.parentElement;
    if (!lane) return;
    dragInfo.current = {
      startX: e.clientX,
      laneW: lane.getBoundingClientRect().width || 1,
      baseLeft,
      bar,
      rowId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ ref: bar.reference, deltaFrac: 0 });
  }

  function onPointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    const info = dragInfo.current;
    if (!info || !drag) return;
    const raw = (e.clientX - info.startX) / info.laneW;
    // keep the bar's left edge on-canvas
    const deltaFrac = Math.max(-info.baseLeft, Math.min(0.99 - info.baseLeft, raw));
    setDrag({ ref: info.bar.reference, deltaFrac });
  }

  function onPointerUp(e: React.PointerEvent<HTMLSpanElement>) {
    const info = dragInfo.current;
    const d = drag;
    dragInfo.current = null;
    setDrag(null);
    if (!info || !d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (Math.abs(d.deltaFrac) < DRAG_THRESHOLD || !onReschedule) return; // a click
    const deltaMs = d.deltaFrac * spanMs;
    const ns = shiftEngineDate(info.bar.start || info.bar.end, deltaMs);
    const ne = shiftEngineDate(info.bar.end || info.bar.start, deltaMs);
    if (!ns || !ne) return;
    setPendingRef(info.bar.reference);
    onReschedule(info.bar, info.rowId, ns, ne).finally(() => setPendingRef(null));
  }

  return (
    <div className="gantt" role="table" aria-label="Demand pegging Gantt">
      <div className="gantt-head" role="row">
        <div className="gantt-label gantt-label--head" role="columnheader">
          Supply step
        </div>
        <div className="gantt-lane gantt-lane--head" role="columnheader">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="gantt-tick"
              style={{ left: `${t.fraction * 100}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {rows.map((row) => (
        <div
          className={`gantt-row${affected?.has(row.id) ? " gantt-row--affected" : ""}`}
          role="row"
          key={row.id}
        >
          <div
            className="gantt-label"
            role="rowheader"
            style={{ paddingLeft: 10 + Math.max(0, row.depth - 1) * 16 }}
            title={`${row.operation} · required ${row.quantity}`}
          >
            <span className={`gantt-type gantt-type--${row.type.toLowerCase()}`}>
              {row.type || "—"}
            </span>
            <span className="gantt-op">{row.operation}</span>
          </div>
          <div className="gantt-lane" role="cell">
            {nowFrac != null && (
              <span
                className="gantt-marker gantt-marker--now"
                style={{ left: `${nowFrac * 100}%` }}
                title={`current: ${window.current}`}
                aria-hidden
              />
            )}
            {dueFrac != null && (
              <span
                className="gantt-marker gantt-marker--due"
                style={{ left: `${dueFrac * 100}%` }}
                title={`due: ${window.due}`}
                aria-hidden
              />
            )}
            {row.bars.map((b, i) => {
              const baseLeft = fractionOf(b.start || b.end, startMs, endMs);
              if (baseLeft == null) return null;
              const endF = fractionOf(b.end || b.start, startMs, endMs) ?? baseLeft;
              const dragging = drag?.ref === b.reference ? drag.deltaFrac : 0;
              const left = baseLeft + dragging;
              const widthPct = Math.max(0.8, (endF - baseLeft) * 100);
              const editable = !!onReschedule && isReschedulable(b.type, b.status);
              const cls = STATUS_CLASS[b.status] ?? "gantt-bar--proposed";
              return (
                <span
                  key={`${row.id}-${b.reference}-${i}`}
                  className={
                    `gantt-bar ${cls}` +
                    (editable ? " gantt-bar--editable" : "") +
                    (drag?.ref === b.reference ? " gantt-bar--dragging" : "") +
                    (pendingRef === b.reference ? " gantt-bar--pending" : "")
                  }
                  style={{ left: `${left * 100}%`, width: `${widthPct}%` }}
                  title={barTooltip(b, editable)}
                  onPointerDown={
                    editable
                      ? (e) => onPointerDown(e, b, baseLeft, row.id)
                      : undefined
                  }
                  onPointerMove={editable ? onPointerMove : undefined}
                  onPointerUp={editable ? onPointerUp : undefined}
                >
                  <span className="gantt-bar-q">{b.quantity}</span>
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
