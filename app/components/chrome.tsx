import { useState } from "react";
import { Link, NavLink, useRouteLoaderData } from "react-router";
import { Logo } from "./brand";
import UserMenu from "./UserMenu";

type RootData = { user: { id: string; email: string; name: string } | null };

export function useUser() {
  return (useRouteLoaderData("root") as RootData | undefined)?.user ?? null;
}

export function SiteHeader() {
  const user = useUser();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <Logo />
      <nav className={`site-nav${open ? " is-open" : ""}`} aria-label="Primary">
        <NavLink to="/atlas">Atlas</NavLink>
        <NavLink to="/docs">Docs</NavLink>
        <NavLink to="/agents">Agents</NavLink>
        <a href="/#pricing">Pricing</a>
        {user ? null : <NavLink to="/login" className="mobile-only">Log in</NavLink>}
      </nav>
      <div className="site-actions">
        {user ? (
          <>
            <Link className="btn btn-primary" to="/console">Console</Link>
            <UserMenu name={user.name} email={user.email} />
          </>
        ) : (
          <>
            <Link className="btn btn-ghost desktop-only" to="/login">Log in</Link>
            <Link className="btn btn-primary" to="/sign-up">Get started</Link>
          </>
        )}
        <button type="button" className="btn btn-ghost menu-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <Logo to={null} />
        <p>Compass for Machines. The physical world, as an API.</p>
        <small>© 2026 EDK</small>
      </div>
      <nav className="footer-col" aria-label="Product">
        <span className="label">Product</span>
        <Link to="/atlas">Atlas</Link>
        <a href="/#pricing">Pricing</a>
        <Link to="/console">Console</Link>
        <Link to="/sign-up">Sign up</Link>
      </nav>
      <nav className="footer-col" aria-label="Developers">
        <span className="label">Developers</span>
        <Link to="/docs">Docs</Link>
        <Link to="/docs#search">API reference</Link>
        <Link to="/docs#sdk">SDK, CLI &amp; MCP</Link>
        <Link to="/docs#embeds">Embeds</Link>
      </nav>
      <nav className="footer-col" aria-label="Agents">
        <span className="label">Agents</span>
        <Link to="/agents">Connect your agent</Link>
        <a href="/agents.md">agents.md</a>
        <a href="/llms.txt">llms.txt</a>
        <Link to="/brand">Brand</Link>
      </nav>
    </footer>
  );
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
