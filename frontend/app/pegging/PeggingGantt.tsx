"use client";

import {
  axisTicks,
  fractionOf,
  parseEngineDate,
  type Pegging,
  type PeggingBar,
} from "@/lib/pegging";

// Read-only demand-pegging Gantt (Phase 3-D1). Renders the supply-chain tree as
// indented lanes of operationplan bars on a shared dated axis, with due ("now"
// is neutral, due is the signal marker) reference lines. Bars are absolutely
// positioned by date fraction - HTML/CSS, not SVG, so D2 can add pointer-drag
// rescheduling without re-plumbing the geometry.

const STATUS_CLASS: Record<string, string> = {
  proposed: "gantt-bar--proposed",
  approved: "gantt-bar--firm",
  confirmed: "gantt-bar--firm",
  completed: "gantt-bar--done",
  closed: "gantt-bar--done",
};

function barTooltip(b: PeggingBar): string {
  const dates =
    b.start && b.end && b.start !== b.end
      ? `${b.start} → ${b.end}`
      : b.start || b.end || "no dates";
  const risk = b.criticality > 0 ? `\ncriticality ${b.criticality}` : "";
  return `${b.type} ${b.reference}\n${b.operation}\nqty ${b.quantity}\n${b.status} · ${dates}${risk}`;
}

export default function PeggingGantt({ pegging }: { pegging: Pegging }) {
  const { window, rows } = pegging;
  const startMs = parseEngineDate(window.start);
  const endMs = parseEngineDate(window.end);
  const ticks = axisTicks(window);
  const dueFrac = fractionOf(window.due, startMs, endMs);
  const nowFrac = fractionOf(window.current, startMs, endMs);

  if (!rows.length) {
    return (
      <div className="empty">
        NO PEGGING — THIS DEMAND IS UNPLANNED. RUN A PLAN FIRST.
      </div>
    );
  }

  return (
    <div className="gantt" role="table" aria-label="Demand pegging Gantt">
      {/* Axis header: spans the timeline column with dated ticks. */}
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
        <div className="gantt-row" role="row" key={row.id}>
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
              const left = fractionOf(b.start || b.end, startMs, endMs);
              if (left == null) return null;
              const endF = fractionOf(b.end || b.start, startMs, endMs) ?? left;
              const widthPct = Math.max(0.8, (endF - left) * 100); // min visible
              const cls = STATUS_CLASS[b.status] ?? "gantt-bar--proposed";
              return (
                <span
                  key={`${b.reference}-${i}`}
                  className={`gantt-bar ${cls}`}
                  style={{ left: `${left * 100}%`, width: `${widthPct}%` }}
                  title={barTooltip(b)}
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
