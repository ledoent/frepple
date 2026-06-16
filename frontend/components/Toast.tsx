"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "info" | "ok" | "error";
type Toast = { id: number; kind: ToastKind; title: string; body?: string };

type ToastApi = (kind: ToastKind, title: string, body?: string) => void;

const ToastCtx = createContext<ToastApi>(() => {});

// Minimal toast system: a provider that renders a fixed stack, plus useToast()
// for any client component to push a transient message. Replaces the app's
// previous silent failures (a click with no visible result).
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let seq = 0;

  const push = useCallback<ToastApi>((kind, title, body) => {
    const id = Date.now() + seq++;
    setToasts((t) => [...t, { id, kind, title, body }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 5200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toaststack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <div>
              <div className="toast-title">{t.title}</div>
              {t.body && <div style={{ color: "var(--muted)" }}>{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}
