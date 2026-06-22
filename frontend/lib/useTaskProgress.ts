"use client";

import { useEffect, useRef, useState } from "react";
import { openAuthedSocket, scenarioPrefix } from "./ws";
import { isAuthError } from "./errors";

export type TaskUpdate = {
  id: number;
  name: string;
  status: string | null;
  message: string | null;
  started: string | null;
  finished: string | null;
};

// Subscribe to live task progress over ws/tasks/ (Phase 1A), replacing the
// legacy 5s polling. Auto-reconnects; the server pushes one message per task
// status change.
export function useTaskProgress(scenario = ""): {
  tasks: TaskUpdate[];
  connected: boolean;
  authError: boolean;
} {
  const [tasks, setTasks] = useState<Record<number, TaskUpdate>>({});
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function connect(): Promise<void> {
      try {
        const ws = await openAuthedSocket(`${scenarioPrefix(scenario)}/ws/tasks/`);
        if (closed) {
          ws.close();
          return; // unmounted while awaiting the token — don't leak the socket
        }
        setAuthError(false);
        wsRef.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onmessage = (e: MessageEvent) => {
          const t = JSON.parse(e.data) as TaskUpdate;
          setTasks((prev) => ({ ...prev, [t.id]: t }));
        };
        ws.onclose = () => {
          setConnected(false);
          if (!closed) retry = setTimeout(connect, 2000);
        };
      } catch (e) {
        // No Django session: surface it (the screen prompts sign-in) instead of
        // looping invisibly. Other errors retry with a fixed 2s backoff.
        if (isAuthError(e)) {
          setAuthError(true);
          return;
        }
        if (!closed) retry = setTimeout(connect, 2000);
      }
    }

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [scenario]);

  return {
    tasks: Object.values(tasks).sort((a, b) => b.id - a.id),
    connected,
    authError,
  };
}
