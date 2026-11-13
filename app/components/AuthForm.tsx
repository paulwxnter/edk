import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { authClient } from "~/lib/auth-client";
import { FREE_CU } from "~/lib/pricing";

export default function AuthForm({ mode }: { mode: "login" | "sign-up" }) {
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/console";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function resend() {
    if (!sentTo) return;
    await authClient.sendVerificationEmail({ email: sentTo, callbackURL: next });
    setResent(true);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    setBusy(true);
    setError(null);
    const res =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: String(form.get("name") || "").trim() || email.split("@")[0], callbackURL: next })
        : await authClient.signIn.email({ email, password, callbackURL: next });
    setBusy(false);
    if (res.error) {
      if (res.error.status === 403 || res.error.code === "EMAIL_NOT_VERIFIED") {
        setSentTo(email);
        return;
      }
      setError(res.error.message || (mode === "sign-up" ? "Could not create the account." : "Wrong email or password."));
      return;
    }
    // Verification required: no session yet, the email link finishes sign-up.
    if (mode === "sign-up" && !(res.data as any)?.token) {
      setSentTo(email);
      return;
    }
    window.location.assign(next);
  }

  if (sentTo) {
    return (
      <div className="auth-card">
        <h1>Check your inbox</h1>
        <p className="muted">We sent a verification link to <strong style={{ color: "var(--fg)" }}>{sentTo}</strong>. Open it to {mode === "sign-up" ? "finish creating your account" : "confirm your email and log in"}.</p>
        <p className="faint" style={{ fontSize: ".86rem" }}>The link works for 24 hours. Check spam if it doesn't arrive in a minute.</p>
        <div className="row" style={{ marginTop: "1.2rem" }}>
          <button type="button" className="btn" onClick={resend} disabled={resent}>{resent ? "Sent again" : "Resend the email"}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setSentTo(null); setResent(false); }}>Use another email</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1>{mode === "sign-up" ? "Create your account" : "Welcome back"}</h1>
      <p className="muted" style={{ margin: 0 }}>{mode === "sign-up" ? `Start with ${FREE_CU} free CU. No card needed.` : "Log in to the EDK console."}</p>
      {params.get("error") ? <div className="notice is-error" style={{ marginTop: "1rem" }}>That link is invalid or expired. Log in to get a new one.</div> : null}
      <form onSubmit={submit}>
        {mode === "sign-up" ? (
          <label className="field"><span>Name</span><input className="input" name="name" autoComplete="name" maxLength={80} /></label>
        ) : null}
        <label className="field"><span>Email</span><input className="input" name="email" type="email" autoComplete="email" required /></label>
        <label className="field"><span>Password</span><input className="input" name="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength={8} required /></label>
        {error ? <div className="notice is-error" role="alert">{error}</div> : null}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : mode === "sign-up" ? "Create account" : "Log in"}</button>
      </form>
      <p className="auth-foot">
        {mode === "sign-up" ? <>Already have an account? <Link to={`/login${next !== "/console" ? `?next=${encodeURIComponent(next)}` : ""}`}>Log in</Link></> : <>New to EDK? <Link to="/sign-up">Create an account</Link></>}
      </p>
    </div>
  );
}
