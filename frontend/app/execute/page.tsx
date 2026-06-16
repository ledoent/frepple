"use client";

import { useState } from "react";
import { getToken } from "@/lib/auth";
import { csrfToken } from "@/lib/csrf";
import { loginUrl } from "@/lib/session";
import { useTaskProgress, type TaskUpdate } from "@/lib/useTaskProgress";
import { useTaskLog } from "@/lib/useTaskLog";
import { parseStatus, type TaskState } from "@/lib/ws";
import { useToast } from "@/components/Toast";

// Execute / plan-run console (Phase 1A). Live task progress streams over
// ws/tasks/ and the log tail over ws/tasks/{id}/log/ — no polling. Launching a
// plan POSTs to the Django (WSGI) endpoint; failures (no session, CSRF, server
// error) now surface as toasts + an inline notice instead of doing nothing.
export default function ExecutePage() {
  const { tasks, connected, authError } = useTaskProgress();
  const [selected, setSelected] = useState<number | null>(null);
  const [launching, setLaunching] = useState(false);
  const toast = useToast();

  const running = tasks.filter(
    (t) => parseStatus(t.status).state === "running",
  ).length;

  async function launchPlan() {
    setLaunching(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      const csrf = csrfToken();
      if (csrf) headers["X-CSRFToken"] = csrf;
      const res = await fetch("/execute/launch/runplan/", {
        method: "POST",
        headers,
        credentials: "include",
      });
      // The launch view 302-redirects to /execute/ on success; a redirect back
      // to the login page means the session/CSRF was rejected.
      if (res.url.includes("/login") || res.status === 401 || res.status === 403) {
        toast("error", "Sign-in required", "Your session expired — sign in again.");
      } else if (!res.ok && !res.redirected) {
        toast("error", "Launch failed", `Server returned ${res.status}.`);
      } else {
        toast("ok", "Plan launched", "Watch live progress below.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/\b40[13]\b/.test(msg)) {
        toast("error", "Sign-in required", "Sign in to launch a plan.");
      } else {
        toast("error", "Launch failed", msg);
      }
    } finally {
      setLaunching(false);
    }
  }

  return (
    <main>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Planning engine</div>
          <h1 className="h1">Execute</h1>
          <p className="subtle">
            Run the C++ planning engine and watch each task stream to completion
            over the live websocket.
          </p>
        </div>
        <ConnDot connected={connected} />
      </div>

      {authError && (
        <div className="notice notice--auth" style={{ marginBottom: 18 }}>
          <span className="dot dot--fail" aria-hidden />
          <span>
            No active session — the live feed can&apos;t connect.{" "}
            <a href={loginUrl("/execute")}>Sign in</a> to continue.
          </span>
        </div>
      )}

      <section className="console" aria-label="Launch console">
        <div className="console-cell">
          <div className="eyebrow" style={{ color: "var(--faint)" }}>
            System status
          </div>
          <div className="metric-row">
            <div className="metric-block">
              <div className="metric">{tasks.length}</div>
              <div className="eyebrow">Tasks</div>
            </div>
            <div className="metric-block">
              <div className="metric" style={{ color: "var(--signal)" }}>
                {running}
              </div>
              <div className="eyebrow">Running</div>
            </div>
            <div className="metric-block">
              <div
                className="metric"
                style={{ color: connected ? "var(--ok)" : "var(--faint)" }}
              >
                {connected ? "LIVE" : "—"}
              </div>
              <div className="eyebrow">Feed</div>
            </div>
          </div>
        </div>
        <div className="console-cell is-action">
          <div className="eyebrow" style={{ color: "var(--faint)" }}>
            Primary action
          </div>
          <button
            onClick={launchPlan}
            disabled={launching}
            className={`btn btn-primary${launching ? " is-armed" : ""}`}
            style={{ justifyContent: "center", fontSize: 13, padding: "12px 18px" }}
          >
            {launching ? "Launching…" : "Run plan"}
          </button>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>
            Computes demand &amp; supply for the default scenario.
          </span>
        </div>
      </section>

      <div className="panel-title" style={{ marginBottom: 12 }}>
        Task feed
      </div>
      <section className="feed">
        {tasks.length === 0 && (
          <div className="empty">
            {connected ? "NO TASKS YET — RUN A PLAN TO BEGIN" : "AWAITING FEED…"}
          </div>
        )}
        {tasks.map((t, i) => (
          <TaskRow
            key={t.id}
            task={t}
            index={i}
            selected={selected === t.id}
            onSelect={() => setSelected(selected === t.id ? null : t.id)}
          />
        ))}
      </section>

      {selected != null && <LogPanel taskId={selected} />}
    </main>
  );
}

const STATE_TAG: Record<TaskState, { cls: string; label: string }> = {
  waiting: { cls: "", label: "Queued" },
  running: { cls: "tag--run", label: "Running" },
  done: { cls: "tag--done", label: "Done" },
  failed: { cls: "tag--fail", label: "Failed" },
  canceled: { cls: "tag--fail", label: "Canceled" },
};

function TaskRow({
  task,
  index,
  selected,
  onSelect,
}: {
  task: TaskUpdate;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { percent, state } = parseStatus(task.status);
  const tag = STATE_TAG[state];
  const fillCls =
    state === "failed"
      ? "bar-fill bar-fill--fail"
      : state === "running"
        ? "bar-fill bar-fill--run"
        : "bar-fill";
  return (
    <button
      onClick={onSelect}
      className={`task${selected ? " is-selected" : ""}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="task-top">
        <span className="task-name">
          <span className="task-id">#{task.id}</span> {task.name}
        </span>
        <span className={`tag ${tag.cls}`}>{task.status ?? tag.label}</span>
      </div>
      <div className="bar">
        <div className={fillCls} style={{ width: `${percent}%` }} />
      </div>
      {task.message && <div className="task-msg">{task.message}</div>}
    </button>
  );
}

function LogPanel({ taskId }: { taskId: number }) {
  const { log, done, connected } = useTaskLog(taskId);
  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <span className="panel-title">Log — task #{taskId}</span>
        <span className="stat">
          <span
            className={`dot${done ? "" : connected ? " dot--run" : ""}`}
            aria-hidden
          />
          {done ? "finished" : connected ? "streaming" : "connecting"}
        </span>
      </div>
      <pre className="log">{log || "(no output yet)"}</pre>
    </section>
  );
}

function ConnDot({ connected }: { connected: boolean }) {
  return (
    <span className="stat" title={connected ? "live" : "disconnected"}>
      <span className={`dot${connected ? " dot--live" : ""}`} aria-hidden />
      {connected ? "live" : "offline"}
    </span>
  );
}
