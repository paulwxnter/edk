import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { authClient } from "~/lib/auth-client";

/** The signed-in avatar in the site header, with Usage, Account and Sign out. */
export default function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = name || email.split("@")[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="avatar-btn" aria-haspopup="menu" aria-expanded={open} title={email} onClick={() => setOpen(!open)}>
        <span className="avatar">{label.slice(0, 1).toUpperCase()}</span>
      </button>
      {open ? (
        <div className="menu" role="menu">
          <div className="menu-head">
            <strong>{label}</strong>
            <small>{email}</small>
          </div>
          <Link role="menuitem" to="/console/billing" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 19V9m5 10V5m5 14v-7m5 7V8" /></svg>
            Usage
          </Link>
          <Link role="menuitem" to="/console/account" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" /></svg>
            Account
          </Link>
          <hr />
          <button role="menuitem" type="button" onClick={signOut}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" /></svg>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
