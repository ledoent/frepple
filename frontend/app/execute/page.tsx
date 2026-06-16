"use client";

import { useState } from "react";
import { getToken } from "@/lib/auth";
import { useTaskProgress, type TaskUpdate } from "@/lib/useTaskProgress";
import { useTaskLog } from "@/lib/useTaskLog";
import { parseStatus } from "@/lib/ws";

// Phase 1A beachhead: the Execute / plan-run screen. Live task progress comes
// from ws/tasks/ and the log tail from ws/tasks/{id}/log/ - no polling.
export default function ExecutePage() {
  const { tasks, connected } = useTaskProgress();
  const [selected, setSelected] = useState<number | null>(null);
  const [launching, setLaunching] = useState(false);

  async function launchPlan() {
    setLaunching(true);
    try {
      const token = await getToken();
      // The runplan launch endpoint accepts the same JWT; the new task then
      // streams its progress over the already-open websocket.
      // Launch via the Django execute endpoint (WSGI); the new task then streams
      // its progress over the already-open websocket.
      await fetch("/execute/launch/runplan/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
    } finally {
      setLaunching(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Execute</h1>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <ConnDot connected={connected} />
          <button onClick={launchPlan} disabled={launching} style={btn}>
            {launching ? "Launching…" : "Run plan"}
          </button>
        </span>
      </header>

      <section style={{ marginTop: 20, display: "grid", gap: 8 }}>
        {tasks.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No tasks yet.</p>
        )}
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            selected={selected === t.id}
            onSelect={() => setSelected(selected === t.id ? null : t.id)}
          />
        ))}
      </section>

      {selected != null && <LogPanel taskId={selected} />}
    </main>
  );
}

function TaskRow({
  task,
  selected,
  onSelect,
}: {
  task: TaskUpdate;
  selected: boolean;
  onSelect: () => void;
}) {
  const { percent, state } = parseStatus(task.status);
  const color =
    state === "failed"
      ? "var(--fail)"
      : state === "done"
        ? "var(--ok)"
        : "var(--accent)";
  return (
    <button
      onClick={onSelect}
      style={{
        ...panel,
        textAlign: "left",
        cursor: "pointer",
        outline: selected ? "1px solid var(--accent)" : "none",
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <strong>
          #{task.id} {task.name}
        </strong>
        <span style={{ color: "var(--muted)" }}>{task.status ?? "—"}</span>
      </div>
      <div
        style={{
          height: 6,
          marginTop: 8,
          borderRadius: 3,
          background: "var(--border)",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: 3,
            background: color,
            transition: "width .3s ease",
          }}
        />
      </div>
      {task.message && (
        <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}>
          {task.message}
        </div>
      )}
    </button>
  );
}

function LogPanel({ taskId }: { taskId: number }) {
  const { log, done, connected } = useTaskLog(taskId);
  return (
    <section style={{ ...panel, marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <strong>Log — task #{taskId}</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {done ? "finished" : connected ? "streaming…" : "connecting…"}
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          maxHeight: 320,
          overflow: "auto",
          fontSize: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        {log || "(no output yet)"}
      </pre>
    </section>
  );
}

function ConnDot({ connected }: { connected: boolean }) {
  return (
    <span
      title={connected ? "live" : "disconnected"}
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: connected ? "var(--ok)" : "var(--muted)",
        display: "inline-block",
      }}
    />
  );
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
  color: "var(--text)",
  width: "100%",
};

const btn: React.CSSProperties = {
  background: "var(--accent)",
  color: "white",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
};
