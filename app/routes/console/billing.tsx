import { useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/billing";
import { CU_DEFINITION, CU_PRICE_USD, FREE_CU, SIGNALS_MONTHLY_CENTS, MAX_TOPUP_USD, MIN_TOPUP_USD, TOPUP_PRESETS, UNITS_PER_CU, cuForDollars, formatCu, formatUsd } from "~/lib/pricing";
import { TIERS, nextTier } from "~/lib/tiers";
import { getSessionUser } from "../../../server/auth";
import { dailyUsage, listPurchases, recentUsage, saveSettings, spendable } from "../../../server/store";
import { createTopUp, getSignalsPlan, openSignalsBilling, settleCheckout, type SignalsPlan } from "../../../server/stripe";
import { hasSignalsGrant } from "../../../server/signals-access";

type BillingTab = "usage" | "signals";
const tabOf = (v: string | null): BillingTab => (v === "signals" ? "signals" : "usage");

export const meta = () => [{ title: "Billing & Usage · EDK Console" }];

async function requireUser(request: Request, db: D1Database) {
  const user = await getSessionUser(db, request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  const user = await requireUser(request, db);
  const url = new URL(request.url);
  let checkout: "credited" | "pending" | "canceled" | null = url.searchParams.has("canceled") ? "canceled" : null;
  const sessionId = url.searchParams.get("checkout");
  if (sessionId) {
    const settled = await settleCheckout(db, sessionId, user.id).catch(() => ({ paid: false }));
    checkout = settled.paid ? "credited" : "pending";
  }
  const tab = tabOf(url.searchParams.get("tab"));
  // Stripe is only asked about Signals when its tab is open.
  const signalsPending: Promise<{ plan: SignalsPlan | null; granted: boolean; failed: boolean }> = tab === "signals"
    ? Promise.all([getSignalsPlan(db, user.id), hasSignalsGrant(db, user.id).catch(() => false)])
        .then(([plan, granted]) => ({ plan, granted, failed: false }))
        .catch(() => ({ plan: null, granted: false, failed: true }))
    : Promise.resolve({ plan: null, granted: false, failed: false });
  const [account, days, purchases, recent, signals] = await Promise.all([spendable(db, user.id), dailyUsage(db, user.id, 30), listPurchases(db, user.id), recentUsage(db, user.id, 20), signalsPending]);
  return { tab, signals, balance: account.balance, free: account.free, used: account.used, settings: account.settings, tierId: account.tier.id, added: account.added, days, purchases, recent, checkout, mode: (process.env.STRIPE_MODE as string) === "live" ? "live" : "test" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  const user = await requireUser(request, db);
  const form = await request.formData();
  if (form.get("intent") === "signals") {
    if (await hasSignalsGrant(db, user.id).catch(() => false)) return redirect("/signals");
    try {
      return redirect(await openSignalsBilling(db, user, new URL(request.url).origin, "/console/billing?tab=signals"));
    } catch (error) {
      console.error("[edk] Signals billing failed", error instanceof Error ? error.message : error);
      return { signalsError: "Signals billing is temporarily unavailable. Try again shortly." };
    }
  }
  if (form.get("intent") === "limits") {
    const parse = (v: FormDataEntryValue | null, max: number) => {
      const n = Number(String(v ?? "").trim());
      return String(v ?? "").trim() === "" || !Number.isFinite(n) || n <= 0 ? null : Math.min(max, Math.floor(n));
    };
    await saveSettings(db, user.id, { max_results: parse(form.get("max_results"), 200), monthly_cu_cap: parse(form.get("monthly_cu_cap"), 10_000_000) });
    return { saved: true as const };
  }
  const usd = Number(form.get("amount"));
  try {
    const site = new URL(request.url).origin;
    const url = await createTopUp(db, { id: user.id, email: user.email }, usd, site);
    return redirect(url);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Checkout is unavailable right now." };
  }
}

function UsageChart({ days }: { days: { day: string; units: number; calls: number }[] }) {
  const W = 720, H = 200, padL = 36, padB = 22, padT = 10;
  const max = Math.max(1, ...days.map((d) => d.units / UNITS_PER_CU));
  const nice = (() => {
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    const m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  })();
  const bw = (W - padL) / days.length;
  const y = (v: number) => H - padB - (v / nice) * (H - padB - padT);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="CU used per day, last 30 days">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line className="grid" x1={padL} x2={W} y1={y(nice * t)} y2={y(nice * t)} />
          <text className="axis" x={padL - 6} y={y(nice * t) + 3} textAnchor="end">{+(nice * t).toFixed(1)}</text>
        </g>
      ))}
      {days.map((d, i) => {
        const cu = d.units / UNITS_PER_CU;
        const h = Math.max(cu > 0 ? 2 : 0, H - padB - y(cu));
        return (
          <g key={d.day}>
            <rect className="bar" x={padL + i * bw + bw * 0.18} y={H - padB - h} width={bw * 0.64} height={h} rx={1.5}>
              <title>{`${d.day}: ${+cu.toFixed(1)} CU · ${d.calls} calls`}</title>
            </rect>
            {i % 5 === 0 || i === days.length - 1 ? <text className="axis" x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle">{d.day.slice(5)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function Billing({ loaderData }: Route.ComponentProps) {
  const { tab, signals, balance, free, used, settings, days, purchases, recent, checkout, mode, tierId, added } = loaderData;
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0];
  const next = nextTier(tier);
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const [amount, setAmount] = useState(String(MIN_TOPUP_USD));
  const usd = Number(amount);
  const valid = usd >= MIN_TOPUP_USD && usd <= MAX_TOPUP_USD;
  const monthCu = used / UNITS_PER_CU;

  return (
    <div className="console-page">
      <div className="console-head">
        <div>
          <h1>Billing &amp; Usage</h1>
          <p>{tab === "signals" ? "Your EDK Signals plan: data by place and over time, the Data Viewer and exports." : `${CU_DEFINITION} Every account gets ${FREE_CU} free CU each month.`}</p>
        </div>
        {mode === "test" ? <span className="tag is-ochre">Stripe test mode</span> : null}
      </div>

      <nav className="tabs billing-tabs" aria-label="Billing sections">
        <Link to="?tab=usage" className={tab === "usage" ? "active" : undefined} aria-current={tab === "usage" ? "page" : undefined} preventScrollReset>Usage</Link>
        <Link to="?tab=signals" className={tab === "signals" ? "active" : undefined} aria-current={tab === "signals" ? "page" : undefined} preventScrollReset>Signals</Link>
      </nav>

      {tab === "signals" ? (
        <SignalsTab signals={signals} busy={nav.state !== "idle" && nav.formData?.get("intent") === "signals"} error={data && "signalsError" in data ? data.signalsError ?? null : null} />
      ) : (
      <>

      {checkout === "credited" ? <div className="notice is-ok" style={{ marginBottom: "1rem" }}>Payment received. Your credits are in your balance.</div> : null}
      {checkout === "pending" ? <div className="notice" style={{ marginBottom: "1rem" }}>We're confirming your payment. Credits appear as soon as Stripe confirms it.</div> : null}
      {checkout === "canceled" ? <div className="notice" style={{ marginBottom: "1rem" }}>Checkout canceled. Nothing was charged.</div> : null}

      <div className="stats">
        <div className="stat"><span className="label">Balance</span><strong>{formatCu(balance)}</strong><small>CU available · {formatCu(free)} free left this month</small></div>
        <div className="stat"><span className="label">This month</span><strong>{formatCu(used)}</strong><small>CU used{settings.monthly_cu_cap ? ` of ${settings.monthly_cu_cap.toLocaleString("en-US")} limit` : ""}</small></div>
        <div className="stat"><span className="label">Tier</span><strong>{tier.name}</strong><small>{tier.maxResults} results per request · {tier.concurrency} at once</small></div>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Usage, last 30 days</h2>
          <span className="faint mono" style={{ fontSize: ".74rem" }}>CU per day · {+monthCu.toFixed(1)} CU this month</span>
        </div>
        <UsageChart days={days} />
      </section>

      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <section className="panel">
          <h2>Add credits</h2>
          <p>Pay once with Stripe, from {formatUsd(MIN_TOPUP_USD)}. Credits never expire, and adding more unlocks higher tiers.</p>
          <Form method="post" className="pg-form">
            <div className="presets">
              {TOPUP_PRESETS.map((p) => (
                <button key={p} type="button" className={`btn${Number(amount) === p ? " active" : ""}`} onClick={() => setAmount(String(p))}>{formatUsd(p)}</button>
              ))}
            </div>
            <label className="field">
              <span>Custom amount (USD)</span>
              <input className="input" name="amount" type="number" min={MIN_TOPUP_USD} max={MAX_TOPUP_USD} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <small>{valid ? `${cuForDollars(usd).toLocaleString("en-US")} CU` : `Enter ${formatUsd(MIN_TOPUP_USD)} to ${formatUsd(MAX_TOPUP_USD)}`}</small>
            </label>
            <button className="btn btn-primary" type="submit" disabled={!valid || nav.state !== "idle"}>{nav.state !== "idle" && nav.formData?.get("intent") !== "limits" ? <span className="spinner" /> : `Add ${valid ? formatUsd(usd) : "credits"}`}</button>
            {data && "error" in data && data.error ? <div className="notice is-error">{data.error}</div> : null}
          </Form>
        </section>

        <section className="panel">
          <h2>Limits</h2>
          <p>Cap what a single search returns and what the account spends each month. Leave empty for no limit.</p>
          <Form method="post" className="pg-form">
            <input type="hidden" name="intent" value="limits" />
            <label className="field">
              <span>Max results per search</span>
              <input className="input" name="max_results" type="number" min={1} max={tier.maxResults} defaultValue={settings.max_results ?? ""} placeholder={String(tier.maxResults)} />
              <small>Up to {tier.maxResults} on {tier.name}. Applies to the API, playground and embeds.</small>
            </label>
            <label className="field">
              <span>Monthly CU limit</span>
              <input className="input" name="monthly_cu_cap" type="number" min={1} defaultValue={settings.monthly_cu_cap ?? ""} placeholder="No limit" />
              <small>Calls are refused once the month's usage reaches it.</small>
            </label>
            <div className="row">
              <button className="btn" type="submit" disabled={nav.state !== "idle"}>Save limits</button>
              {data && "saved" in data ? <span className="muted" style={{ fontSize: ".86rem" }}>Saved.</span> : null}
            </div>
          </Form>
        </section>
      </div>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Tiers</h2>
          <span className="faint" style={{ fontSize: ".82rem" }}>{next ? `${formatUsd(Math.max(0, (next.unlockDollars ?? 0) - added))} more unlocks ${next.name}` : "Highest self-serve tier"}</span>
        </div>
        <p>Credits you add over time unlock higher tiers. Tiers raise how many results one request returns and how many requests run at once.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tier</th><th>Unlock</th><th className="num">Results per request</th><th className="num">Requests at once</th></tr></thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t.id} className={t.id === tier.id ? "is-current" : undefined}>
                  <td>{t.name}{t.id === tier.id ? <span className="tag is-ochre" style={{ marginLeft: ".5rem" }}>Current</span> : null}</td>
                  <td className="faint">{t.unlockDollars === null ? "Contact us" : t.unlockDollars === 0 ? "Free" : `${formatUsd(t.unlockDollars)} added`}</td>
                  <td className="num">{t.maxResults}</td>
                  <td className="num">{t.concurrency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Recent calls</h2>
        {recent.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Source</th><th>Call</th><th>Query</th><th className="num">Locations</th><th className="num">Areas</th><th className="num">CU</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="faint" style={{ whiteSpace: "nowrap" }}>{when(r.created_at)}</td>
                    <td><span className="tag">{r.source}</span></td>
                    <td className="mono" style={{ fontSize: ".8rem" }}>{r.endpoint}</td>
                    <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.result_id ? <a href={`https://embed.edk.earth/r/${r.result_id}`} target="_blank" rel="noreferrer">{r.query}</a> : r.query}</td>
                    <td className="num">{r.results}</td>
                    <td className="num">{r.images}</td>
                    <td className="num">{+(r.units / UNITS_PER_CU).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>No calls yet. Try the Playground.</p>}
      </section>

      {purchases.length ? (
        <section className="panel">
          <h2>Purchases</h2>
          <table className="table">
            <thead><tr><th>Date</th><th className="num">Amount</th><th className="num">CU</th></tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}><td>{when(p.created_at)}</td><td className="num">{formatUsd(p.amount_cents / 100)}</td><td className="num">{formatCu(p.units)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      </>
      )}
    </div>
  );
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const STATUS: Record<string, string> = { active: "Active", trialing: "Trial", past_due: "Payment due", unpaid: "Unpaid", paused: "Paused" };

function SignalsTab({ signals, busy, error }: { signals: { plan: SignalsPlan | null; granted: boolean; failed: boolean }; busy: boolean; error: string | null }) {
  const { plan, granted, failed } = signals;
  const active = granted || plan?.status === "active";
  const price = plan?.amountCents != null ? `${formatUsd(plan.amountCents / 100)}${plan.interval ? ` / ${plan.interval}` : ""}` : `${formatUsd(SIGNALS_MONTHLY_CENTS / 100)} / month, billed yearly`;
  return (
    <>
      <div className="stats">
        <div className="stat">
          <span className="label">Plan</span>
          <strong>{active ? "EDK Signals" : "Signals Free"}</strong>
          <small>{granted ? "Access granted to this account" : plan ? STATUS[plan.status] ?? plan.status : "Annual data only"}</small>
        </div>
        <div className="stat">
          <span className="label">Price</span>
          <strong>{granted ? "Included" : plan ? price : formatUsd(SIGNALS_MONTHLY_CENTS / 100)}</strong>
          <small>{granted ? "No charge" : plan ? "Billed by Stripe" : "per month, billed yearly"}</small>
        </div>
        <div className="stat">
          <span className="label">{plan?.cancelAtPeriodEnd ? "Ends" : "Renews"}</span>
          <strong>{plan?.periodEnd ? day(plan.periodEnd) : "—"}</strong>
          <small>{plan?.cancelAtPeriodEnd ? "Access stops on this date" : plan ? "Renews automatically" : "No subscription"}</small>
        </div>
      </div>

      {failed ? <div className="notice" style={{ marginBottom: "1rem" }}>We could not reach Stripe to load your Signals plan. Refresh to try again.</div> : null}
      {error ? <div className="notice is-error" style={{ marginBottom: "1rem" }}>{error}</div> : null}

      <section className="panel billing-signals">
        <div>
          <h2>{active ? "Manage your Signals plan" : "Subscribe to EDK Signals"}</h2>
          <p>
            {active
              ? granted
                ? "Signals is enabled for this account. Open Signals to explore data by place and over time."
                : "Change your payment method, download invoices or cancel in the Stripe billing portal."
              : "Monthly and weekly data, regional comparisons, the Data Viewer with date filters, and CSV or JSON exports."}
          </p>
          <ul className="billing-signals-list">
            <li>Annual, monthly and weekly data</li>
            <li>Compare up to five regions</li>
            <li>Data Viewer: browse the records behind every chart</li>
            <li>Export by date range as CSV or JSON</li>
          </ul>
        </div>
        <div className="billing-signals-actions">
          {granted ? null : (
            <Form method="post">
              <input type="hidden" name="intent" value="signals" />
              <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : plan ? "Manage subscription" : "Subscribe to Signals"}</button>
            </Form>
          )}
          <Link className="btn btn-lg" to="/signals">Open Signals</Link>
          {!active ? <Link className="faint" style={{ fontSize: ".8rem" }} to="/pricing?plan=signals">Compare plans</Link> : null}
        </div>
      </section>
    </>
  );
}
