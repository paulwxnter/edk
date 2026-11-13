import { useState } from "react";
import { useRevalidator } from "react-router";
import type { Route } from "./+types/account";
import { authClient } from "~/lib/auth-client";
import { getSessionUser } from "../../../server/auth";

export const meta = () => [{ title: "Account · EDK Console" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getSessionUser(context.cloudflare.env.DB, request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  const row = await context.cloudflare.env.DB.prepare('select "createdAt" as created from "user" where id = ?').bind(user.id).first<{ created: string }>();
  return { user, created: row?.created ?? null };
}

export default function Account({ loaderData }: Route.ComponentProps) {
  const { user, created } = loaderData;
  const revalidator = useRevalidator();
  const [name, setName] = useState(user.name || "");
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy("name");
    const res = await authClient.updateUser({ name: name.trim() });
    setBusy(null);
    setNameMsg(res.error ? { ok: false, text: res.error.message || "Could not save." } : { ok: true, text: "Saved." });
    revalidator.revalidate();
  }

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = String(form.get("next") || "");
    if (next !== String(form.get("confirm") || "")) return setPwMsg({ ok: false, text: "The new passwords don't match." });
    setBusy("pw");
    const res = await authClient.changePassword({ currentPassword: String(form.get("current") || ""), newPassword: next, revokeOtherSessions: true });
    setBusy(null);
    if (res.error) return setPwMsg({ ok: false, text: res.error.message || "Could not change the password." });
    (e.target as HTMLFormElement).reset();
    setPwMsg({ ok: true, text: "Password changed. Other sessions were signed out." });
  }

  return (
    <div className="console-page">
      <div className="console-head">
        <div>
          <h1>Account</h1>
          <p>{user.email}{created ? ` · member since ${new Date(created).toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : ""}</p>
        </div>
      </div>

      <section className="panel">
        <h2>Profile</h2>
        <p>Your name appears in the console.</p>
        <form className="pg-form" onSubmit={saveName}>
          <div className="grid-2">
            <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
            <label className="field"><span>Email</span><input className="input" value={user.email} disabled /></label>
          </div>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy === "name"}>Save</button>
            {nameMsg ? <span className={nameMsg.ok ? "muted" : "notice is-error"}>{nameMsg.text}</span> : null}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Password</h2>
        <p>At least 8 characters.</p>
        <form className="pg-form" onSubmit={changePassword}>
          <label className="field" style={{ maxWidth: 360 }}><span>Current password</span><input className="input" name="current" type="password" autoComplete="current-password" required /></label>
          <div className="grid-2">
            <label className="field"><span>New password</span><input className="input" name="next" type="password" autoComplete="new-password" minLength={8} required /></label>
            <label className="field"><span>Confirm new password</span><input className="input" name="confirm" type="password" autoComplete="new-password" minLength={8} required /></label>
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy === "pw"}>Change password</button>
          </div>
          {pwMsg ? <div className={`notice ${pwMsg.ok ? "is-ok" : "is-error"}`}>{pwMsg.text}</div> : null}
        </form>
      </section>

      <section className="panel">
        <h2>Sign out</h2>
        <p>Sign out of the console on this device. API keys keep working.</p>
        <button className="btn" type="button" onClick={async () => { await authClient.signOut(); window.location.assign("/"); }}>Sign out</button>
      </section>
    </div>
  );
}
