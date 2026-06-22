"use client";

import { useState } from "react";
import { authedFetch } from "./api";
import { openAuthedSocket, parseStatus, scenarioPrefix } from "./ws";

// Re-plan loop for the pegging Gantt (Phase 3-D3). A reschedule persists dates
// but pegging is engine-computed, so it stays stale until a plan runs. `replan`
// launches runplan and resolves once it reaches a terminal state over the task
// websocket — the caller then re-fetches the pegging to show the real downstream.
//
// We subscribe to ws/tasks/ BEFORE launching: TaskProgressConsumer sends no
// backlog (asgi.py), so the only runplan completion we'll see is the one we kick
// off, and subscribing first means we can't miss it.
export function useReplan(scenario = ""): {
  replan: () => Promise<void>;
  running: boolean;
} {
  const [running, setRunning] = useState(false);

  async function replan() {
    setRunning(true);
    let ws: WebSocket | null = null;
    try {
      ws = await openAuthedSocket(`${scenarioPrefix(scenario)}/ws/tasks/`);
      const socket = ws;
      const done = new Promise<void>((resolve) => {
        // Safety cap so a stuck/never-broadcasting plan can't hang the UI.
        const cap = setTimeout(resolve, 120_000);
        socket.onmessage = (e: MessageEvent) => {
          try {
            const t = JSON.parse(e.data) as { name?: string; status?: string };
            if (t.name === "runplan") {
              const s = parseStatus(t.status ?? null).state;
              if (s === "done" || s === "failed" || s === "canceled") {
                clearTimeout(cap);
                resolve();
              }
            }
          } catch {
            /* ignore non-task frames */
          }
        };
        socket.onclose = () => {
          clearTimeout(cap);
          resolve();
        };
      });
      await authedFetch("/execute/launch/runplan/", { method: "POST" });
      await done;
    } finally {
      ws?.close();
      setRunning(false);
    }
  }

  return { replan, running };
}
