import { Form, Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/contact";
import { SiteLayout } from "~/components/chrome";
import { getSessionUser } from "../../server/auth";

export const meta = () => [
  { title: "Contact · EDK" },
  { name: "description", content: "Talk to the people building EDK: questions, sales, support, partnerships and press." },
];

const TOPICS = [
  ["general", "A question"],
  ["sales", "Sales and pricing"],
  ["support", "Help with my account or the API"],
  ["data", "Data, coverage or a city"],
  ["partnerships", "Partnerships"],
  ["press", "Press"],
] as const;

const HOURLY_LIMIT = 5;

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getSessionUser(context.cloudflare.env.DB, request);
  return { signedIn: Boolean(user), name: user?.name ?? null, email: user?.email ?? null };
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  if (!user) return { ok: false as const, error: "Log in to send a message." };
  const form = await request.formData();
  const topic = String(form.get("topic") ?? "");
  const subject = String(form.get("subject") ?? "").trim().slice(0, 160);
  const body = String(form.get("body") ?? "").trim().slice(0, 5000);
  if (!TOPICS.some(([key]) => key === topic)) return { ok: false as const, error: "Pick what it's about." };
  if (!subject) return { ok: false as const, error: "Add a subject." };
  if (body.length < 10) return { ok: false as const, error: "Tell us a little more." };
  const now = Date.now();
  const recent = await db.prepare("select count(*) n from contact_messages where user_id = ? and created_at > ?").bind(user.id, now - 3_600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= HOURLY_LIMIT) return { ok: false as const, error: "You've sent a few already. Try again in an hour." };
  await db
    .prepare("insert into contact_messages (id, user_id, topic, subject, body, page, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 'new', ?, ?)")
    .bind(crypto.randomUUID(), user.id, topic, subject, body, request.headers.get("referer")?.slice(0, 300) ?? null, now, now)
    .run();
  return { ok: true as const, error: null };
}

export default function Contact({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const { signedIn, name, email } = loaderData;
  return (
    <SiteLayout>
      <section className="page-hero">
        <span className="label">Contact</span>
        <h1>Talk to us</h1>
        <p>Questions about EDK-1, a city you need covered, pricing for your team, or something that isn't working. People who build EDK read every message.</p>
      </section>
      <div className="contact">
        <div className="contact-main">
          {!signedIn ? (
            <div className="contact-card contact-gate">
              <h2>Sign up to send a message</h2>
              <p>Messages come from an EDK account so we can see what you're working with and answer you properly. It's free, with free CU every month.</p>
              <div className="row">
                <Link className="btn btn-primary btn-lg" to="/sign-up?next=%2Fcontact">Sign up</Link>
                <Link className="btn btn-lg" to="/login?next=%2Fcontact">Log in</Link>
              </div>
            </div>
          ) : result?.ok ? (
            <div className="contact-card">
              <h2>Message sent</h2>
              <p>Thanks{name ? `, ${name.split(" ")[0]}` : ""}. We'll answer at <strong>{email}</strong>, usually within one working day.</p>
              <div className="row"><Link className="btn" to="/contact" reloadDocument>Send another</Link><Link className="btn btn-ghost" to="/console">Back to Console</Link></div>
            </div>
          ) : (
            <Form method="post" className="contact-card contact-form">
              <div className="contact-from mono">From {name ? <>{name} · </> : null}{email}</div>
              <label className="field"><span>What it's about</span>
                <select className="select" name="topic" defaultValue="general" required>
                  {TOPICS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className="field"><span>Subject</span><input className="input" name="subject" maxLength={160} required /></label>
              <label className="field"><span>Message</span><textarea className="textarea contact-body" name="body" maxLength={5000} minLength={10} required /></label>
              {result && !result.ok ? <div className="notice is-error" role="alert">{result.error}</div> : null}
              <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : "Send message"}</button>
            </Form>
          )}
        </div>
        <aside className="contact-side">
          <div>
            <span className="label">Email</span>
            <a href="mailto:hello@edk.earth">hello@edk.earth</a>
          </div>
          <div>
            <span className="label">Response</span>
            <p>Usually within one working day. Use the chat in the corner for quick questions.</p>
          </div>
          <div>
            <span className="label">Building with EDK</span>
            <p><Link to="/docs">Docs</Link> · <Link to="/docs#discover">API reference</Link> · <Link to="/agents">Connect your agent</Link></p>
          </div>
          <div>
            <span className="label">Pricing</span>
            <p>Plans and CU packs are on <Link to="/pricing">Pricing</Link>. Ask here about volume or a team plan.</p>
          </div>
        </aside>
      </div>
    </SiteLayout>
  );
}
