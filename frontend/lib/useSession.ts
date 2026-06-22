"use client";

import { useEffect, useState } from "react";
import { fetchSession, type Session } from "./session";

export type SessionState = {
  session: Session | null;
  status: "loading" | "authed" | "anon" | "offline";
};

// Resolve the current session once on mount. Used by the app shell (to show the
// user / a sign-in CTA) and by screens to gate data loads behind auth.
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    session: null,
    status: "loading",
  });

  useEffect(() => {
    let alive = true;
    fetchSession()
      .then((s) => {
        if (!alive) return;
        setState({ session: s, status: s ? "authed" : "anon" });
      })
      .catch(() => {
        if (alive) setState({ session: null, status: "offline" });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
