import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/pricing";
import { getSessionUser } from "../../server/auth";
import { hasSignalsSubscription, openSignalsBilling } from "../../server/stripe";
import { hasSignalsGrant } from "../../server/signals-access";
import { SiteLayout, useUser } from "~/components/chrome";
import AsciiArt from "~/ascii/AsciiArt";
import { CU_DEFINITION, CU_PRICE_USD, FREE_CU, SIGNALS_MONTHLY_CENTS, formatUsd } from "~/lib/pricing";
import { REASONING, TIERS, reasoningAllowed } from "~/lib/tiers";

export const meta = () => [{ title: "Pricing · EDK" }, { name: "description", content: "Compare EDK Compute and Signals plans." }];

export const headers = () => ({ "Cache-Control": "private, no-store" });

export async function loader({ request, context }: Route.LoaderArgs) {
  if (new URL(request.url).searchParams.get("plan") !== "signals") return { paid: false, granted: false };
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  const granted = user ? await hasSignalsGrant(db, user.id) : false;
  return { paid: user && !granted ? await hasSignalsSubscription(db, user.id).catch(() => false) : false, granted };
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  if (!user) return redirect("/login?next=%2Fpricing%3Fplan%3Dsignals");
  if (await hasSignalsGrant(db, user.id)) return redirect("/signals");
  try {
    return redirect(await openSignalsBilling(db, user, new URL(request.url).origin));
  } catch (error) {
    console.error("[edk] Signals billing failed", error instanceof Error ? error.message : error);
    return { error: "Signals billing is temporarily unavailable. Try again shortly." };
  }
}

const FREE = TIERS[0];
const TOP = TIERS[TIERS.length - 1];
const names = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0]);
const freeReasoning = names(REASONING.filter((r) => reasoningAllowed(FREE, r.id)).map((r) => r.name));
const paidReasoning = names(REASONING.filter((r) => !reasoningAllowed(FREE, r.id)).map((r) => r.name));

type Row = { name: string; detail?: string; has: boolean };

const CALLS: { name: string; free: string | null; paid: string }[] = [
  { name: "Discover", free: "Find places and areas in plain language.", paid: "Find places and areas in plain language, at scale." },
  { name: "Inspect", free: "Explore the data behind a location.", paid: "Explore the data behind any location." },
  { name: "Route", free: "Plan a trip with stops and driving conditions.", paid: "Plan trips with stops and driving conditions." },
  { name: "Detect", free: "Send an image, get every object in it with its box.", paid: "Send images, get every object in them with its box." },
  { name: "Monitor", free: null, paid: "Watch an area and receive events by webhook or in the console. Tier 4 and above, 0.2 CU per event." },
];

const free: Row[] = [
  ...CALLS.map((c) => ({ name: c.name, detail: c.free ?? "Paid plans only.", has: c.free !== null })),
  { name: "Results", detail: `Up to ${FREE.maxResults} Discover results per request, with an optional written answer.`, has: true },
  { name: "Reasoning", detail: `${freeReasoning}.`, has: true },
];

const paid: Row[] = [
  ...CALLS.map((c) => ({ name: c.name, detail: c.paid, has: true })),
  { name: "Deeper results", detail: `Up to ${TOP.maxResults} Discover results per request.`, has: true },
  { name: "Higher reasoning", detail: `${paidReasoning}, for results studied more closely, at twice the CU.`, has: true },
  { name: "Higher concurrency", detail: `Up to ${TIERS[TIERS.length - 2].concurrency} simultaneous requests on self-serve tiers.`, has: true },
];

const signalsFree: Row[] = [
  { name: "Annual data", has: true },
  { name: "Signal and place search", has: true },
];

const signalsPaid: Row[] = [
  { name: "Annual, monthly, and weekly data", has: true },
  { name: "Real-time insights", detail: "See the latest available records as sources update.", has: true },
  { name: "Data Viewer", detail: "Browse the underlying source records, filtered by date.", has: true },
  { name: "Exports", detail: "Download records by date range as CSV or JSON.", has: true },
  { name: "Regional comparisons and chart filters", has: true },
];

function Mark({ has }: { has: boolean }) {
  return (
    <svg className="price-mark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={has ? "Included" : "Not included"}>
      <path d={has ? "M5 12.5l4.5 4.5L19 7.5" : "M7 7l10 10M17 7 7 17"} />
    </svg>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.name} className={row.has ? undefined : "is-missing"}>
          <Mark has={row.has} />
          <strong>{row.name}</strong>
          {row.detail && <span>{row.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function Pricing({ loaderData, actionData }: Route.ComponentProps) {
  const user = useUser();
  const [params] = useSearchParams();
  const signals = params.get("plan") === "signals";
  const busy = useNavigation().state === "submitting";
  return <SiteLayout><main className="pricing-page">
        <div className="pricing-heading">
          <h1>Pricing</h1>
          <nav className="pricing-tabs seg" aria-label="Pricing plans">
            <Link to="/pricing" aria-current={signals ? undefined : "page"}>Compute</Link>
            <Link to="/pricing?plan=signals" aria-current={signals ? "page" : undefined}>Signals</Link>
          </nav>
        </div>
        {signals ? (
          <section className="section pricing-section" aria-labelledby="signals-pricing-title">
            <div className="section-head">
              <div>
                <h2 id="signals-pricing-title">Track Changes</h2>
                <p>Make better decisions with real-time insights into the things you care about.</p>
              </div>
              <div className="head-art art-host"><AsciiArt art={[{ scene: "houses", x: 0.5, y: 0.55, size: 0.42 }]} /></div>
            </div>
            {actionData?.error && <p className="notice is-error" role="alert">{actionData.error}</p>}
            <div className="pricing pricing-signals">
              <article className="price-card">
                <h3>Free</h3>
                <div className="price">$0</div>
                <Rows rows={signalsFree} />
                <Link className="btn" to="/signals">Explore Signals</Link>
              </article>
              <article className="price-card is-featured">
                <h3>EDK Signals</h3>
                <div className="price">{formatUsd(SIGNALS_MONTHLY_CENTS / 100)} <small>/month <span className="price-note">(Billed Annually)</span></small></div>
                <Rows rows={signalsPaid} />
                {loaderData.granted ? <Link className="btn btn-primary" to="/signals">Open Signals</Link> : user ? (
                  <Form method="post" action="/pricing?plan=signals">
                    <button className="btn btn-primary" type="submit" disabled={busy}>{loaderData.paid ? "Manage subscription" : "Subscribe"}</button>
                  </Form>
                ) : <Link className="btn btn-primary" to="/sign-up?next=%2Fpricing%3Fplan%3Dsignals">Get started</Link>}
              </article>
              <article className="price-card">
                <h3>Team</h3>
                <div className="price">Custom</div>
                <Rows rows={[{ name: "Full Signals access", has: true }, { name: "Team pricing", has: true }]} />
                <a className="btn" href="mailto:hello@edk.earth?subject=EDK%20Signals%20Team">Contact Us</a>
              </article>
            </div>
          </section>
        ) : (

        <section className="section pricing-section" aria-labelledby="pricing-title">
          <div className="section-head">
            <div>
              <h2 id="pricing-title">Pay for compute</h2>
              <p>{CU_DEFINITION} Add credits for higher result, reasoning and concurrency limits.</p>
            </div>
            <div className="head-art art-host"><AsciiArt art={[{ scene: "butterflies", x: 0.5, y: 0.5, size: 0.42 }]} /></div>
          </div>
          <div className="pricing">
            <article className="price-card">
              <h3>Free</h3>
              <div className="price">{FREE_CU} CU <small>/month</small></div>
              <p className="price-compute">NVIDIA T4 <span>· No credit card required</span></p>
              <Rows rows={free} />
              <Link className="btn" to={user ? "/console" : "/sign-up"}>{user ? "Open Playground" : "Get started"}</Link>
            </article>
            <article className="price-card is-featured">
              <h3>Paid</h3>
              <div className="price">${(CU_PRICE_USD * 1000).toFixed(0)} <small>per 1,000 CU</small></div>
              <p className="price-compute">NVIDIA H100</p>
              <Rows rows={paid} />
              <Link className="btn btn-primary" to={user ? "/console/billing" : "/sign-up"}>{user ? "Add credits" : "Create an account"}</Link>
            </article>
          </div>
        </section>
        )}
  </main></SiteLayout>;
}
