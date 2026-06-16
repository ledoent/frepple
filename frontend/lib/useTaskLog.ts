"use client";

import { useEffect, useRef, useState } from "react";
import { openAuthedSocket, scenarioPrefix } from "./ws";

// Stream a task's log tail over ws/tasks/{id}/log/ (Phase 1A-2). The server
// sends {"log": "<new text>"} chunks as the worker appends, and {"done": true}
// when the task finishes.
export function useTaskLog(
  taskId: number | null,
  scenario = "",
): { log: string; done: boolean; connected: boolean } {
  const [log, setLog] = useState("");
  const [done, setDone] = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (taskId == null) return;
    setLog("");
    setDone(false);
    let closed = false;

    async function connect(): Promise<void> {
      try {
        const ws = await openAuthedSocket(
          `${scenarioPrefix(scenario)}/ws/tasks/${taskId}/log/`,
        );
        wsRef.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onmessage = (e: MessageEvent) => {
          const msg = JSON.parse(e.data) as { log?: string; done?: boolean };
          if (msg.log) setLog((prev) => prev + msg.log);
          if (msg.done) setDone(true);
        };
        ws.onclose = () => setConnected(false);
      } catch {
        setConnected(false);
      }
    }

    connect();
    return () => {
      closed = true;
      void closed;
      wsRef.current?.close();
    };
  }, [taskId, scenario]);

  return { log, done, connected };
}
