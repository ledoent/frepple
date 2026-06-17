"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/lib/useSession";
import { loginUrl, logoutUrl } from "@/lib/session";

const NAV = [
  { href: "/execute", label: "Execute", hint: "Plan runs" },
  { href: "/forecast", label: "Forecast", hint: "Demand editor" },
  { href: "/demand", label: "Demand", hint: "Sales orders" },
  { href: "/pegging", label: "Pegging", hint: "Supply trace" },
  { href: "/inventory", label: "Inventory", hint: "On-hand & supply" },
  { href: "/resource", label: "Resource", hint: "Capacity & load" },
];

// The persistent console chrome: a left rail (brand + nav + session) and a top
// status bar (scenario / environment / who's signed in). Wraps every screen.
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const { session, status } = useSession();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">f</span>
          <span>
            <span className="brand-name">frePPLe</span>
            <span className="brand-sub">PLANNING&nbsp;CONSOLE</span>
          </span>
        </div>

        <nav className="nav" aria-label="Primary">
          <span className="nav-label">Workspace</span>
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-item"
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-tick" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <SessionBlock session={session} status={status} path={pathname} />
        </div>
      </aside>

      <div className="main">
        <header className="statusrail">
          <span className="stat">
            <span className="stat-key">scenario</span> <b>default</b>
          </span>
          <span className="stat">
            <span className="stat-key">env</span> <b>staging</b>
          </span>
          <span className="rail-spacer" />
          <RailClock />
          <SessionStat session={session} status={status} path={pathname} />
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

// A live UTC mission-clock in the status rail — the small heartbeat that makes
// the console feel "on". Renders nothing until mounted so SSR and the first
// client paint match (no hydration mismatch from a server-vs-client time).
function RailClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "UTC",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  return (
    <span className="stat rail-clock" aria-hidden suppressHydrationWarning>
      <span className="dot dot--live" />
      <span className="stat-key">utc</span> {now}
    </span>
  );
}

function SessionStat({
  session,
  status,
  path,
}: {
  session: ReturnType<typeof useSession>["session"];
  status: ReturnType<typeof useSession>["status"];
  path: string;
}) {
  if (status === "authed" && session) {
    return (
      <span className="stat">
        <span className="dot dot--live" aria-hidden />
        <b>{session.user}</b>
      </span>
    );
  }
  if (status === "loading") {
    return (
      <span className="stat">
        <span className="dot" aria-hidden /> checking…
      </span>
    );
  }
  return (
    <a className="stat" href={loginUrl(path)} style={{ color: "var(--signal)" }}>
      <span className="dot dot--fail" aria-hidden /> sign in
    </a>
  );
}

function SessionBlock({
  session,
  status,
  path,
}: {
  session: ReturnType<typeof useSession>["session"];
  status: ReturnType<typeof useSession>["status"];
  path: string;
}) {
  if (status === "authed" && session) {
    return (
      <>
        <span className="stat">
          <span className="dot dot--live" aria-hidden /> signed in as{" "}
          <b>{session.user}</b>
        </span>
        <a className="btn btn-mini" href={logoutUrl()}>
          Sign out
        </a>
      </>
    );
  }
  if (status === "loading") {
    return (
      <span className="stat">
        <span className="dot" aria-hidden /> connecting…
      </span>
    );
  }
  return (
    <>
      <span className="stat" style={{ color: "var(--faint)" }}>
        {status === "offline" ? "server unreachable" : "no active session"}
      </span>
      <a className="btn btn-primary btn-mini" href={loginUrl(path)}>
        Sign in
      </a>
    </>
  );
}
