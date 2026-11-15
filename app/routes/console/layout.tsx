import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, redirect, useLocation } from "react-router";
import type { Route } from "./+types/layout";
import { Logo, Wordmark } from "~/components/brand";
import { authClient } from "~/lib/auth-client";
import { formatCu } from "~/lib/pricing";
import { getSessionUser } from "../../../server/auth";
import { getBalance } from "../../../server/store";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getSessionUser(context.cloudflare.env.DB, request);
  if (!user) throw redirect(`/login?next=${encodeURIComponent(new URL(request.url).pathname)}`);
  const balance = await getBalance(context.cloudflare.env.DB, user.id);
  return { user, balance };
}

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const items = [
  { to: "/console", label: "Playground", end: true, d: "M5 4l14 8-14 8V4Z" },
  { to: "/console/atlas", label: "Atlas", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z" },
  { to: "/console/monitor", label: "Monitor", d: "M3 12h4l3-8 4 16 3-8h4" },
  { to: "/console/embeds", label: "Embeds", d: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" },
  { to: "/signals", label: "Signals", d: "M3 17l5-6 4 4 4-7 5 9M3 21h18" },
  { to: "/console/keys", label: "API Keys", d: "M15 7a4 4 0 1 1-3.9 4.9L4 19v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7Zm1.5 2.5h.01" },
  { to: "/console/account", label: "Account", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" },
  { to: "/console/billing", label: "Billing & Usage", d: "M4 19V9m5 10V5m5 14v-7m5 7V8" },
];

export default function ConsoleLayout({ loaderData }: Route.ComponentProps) {
  const { user, balance } = loaderData;
  const name = user.name || user.email.split("@")[0];
  const { pathname } = useLocation();
  const onAtlas = pathname === "/console/atlas";
  // The Atlas gets the whole panel: the sidebar folds to icons there and opens again elsewhere.
  const [collapsed, setCollapsed] = useState(onAtlas);
  useEffect(() => setCollapsed(onAtlas), [onAtlas]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "[" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "")) setCollapsed((c) => !c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }
  return (
    <div className="app-shell" data-sidebar={collapsed ? "collapsed" : "open"}>
      <aside className="app-sidebar" aria-label="Console navigation">
        <div className="sidebar-top">
          <span className="sidebar-logo-full"><Logo /></span>
          <Link className="sidebar-logo-mark" to="/" aria-label="EDK home"><Wordmark height={13} /></Link>
          <button type="button" className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Open sidebar" : "Close sidebar"} title={`${collapsed ? "Open" : "Close"} sidebar  [`}>
            {icon("M4 6h16M4 12h12M4 18h16")}
          </button>
        </div>
        <nav className="sidebar-nav">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} title={item.label} className={item.end && pathname.startsWith("/console/discover/") ? "active" : undefined}>
              {icon(item.d)}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <span className="sidebar-label">Resources</span>
        <nav className="sidebar-nav" style={{ marginTop: 0 }}>
          <Link to="/docs">{icon("M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h12v2")}<span>Docs</span></Link>
          <Link to="/agents">{icon("M8 9h8M8 13h5M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z")}<span>Agents</span></Link>
        </nav>
        <div className="sidebar-bottom">
          <Link className="balance-card" to="/console/billing" title="Billing & Usage">
            <span className="balance-text"><strong>{formatCu(balance)} CU</strong><small>balance</small></span>
            <span className="balance-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            </span>
          </Link>
          <div className="sidebar-user">
            <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
            <span className="sidebar-user-name" title={user.email}>{name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <div className="app-panel">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
