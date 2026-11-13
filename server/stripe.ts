// Stripe over its REST API (no SDK): Checkout Sessions for credit top-ups and webhook verification.
import { cuForDollars, MAX_TOPUP_USD, MIN_TOPUP_USD, UNITS_PER_CU } from "../app/lib/pricing";
import { creditPurchase, getSettings, recordPurchase, saveSettings } from "./store";

const secretKey = () => process.env.STRIPE_SECRET_KEY || "";

function form(params: Record<string, string | number | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
  return body;
}

async function stripe<T = any>(path: string, init: { method?: string; body?: URLSearchParams } = {}): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${secretKey()}`, ...(init.body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: init.body,
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data as T;
}

/** A Checkout Session for `usd` dollars of credit. Returns its URL. */
export async function createTopUp(db: D1Database, user: { id: string; email: string }, usd: number, siteUrl: string) {
  if (!secretKey()) throw new Error("Billing is not configured.");
  const dollars = Math.round(usd * 100) / 100;
  if (!(dollars >= MIN_TOPUP_USD) || dollars > MAX_TOPUP_USD) throw new Error(`Add between $${MIN_TOPUP_USD} and $${MAX_TOPUP_USD.toLocaleString("en-US")}.`);
  const cu = cuForDollars(dollars);
  const units = cu * UNITS_PER_CU;
  const settings = await getSettings(db, user.id);
  let customer = settings.stripe_customer_id;
  if (!customer) {
    const created = await stripe("customers", { body: form({ email: user.email, "metadata[edk_user_id]": user.id }) });
    customer = created.id as string;
    await saveSettings(db, user.id, { stripe_customer_id: customer });
  }
  const session = await stripe("checkout/sessions", {
    body: form({
      mode: "payment",
      customer,
      client_reference_id: user.id,
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": Math.round(dollars * 100),
      "line_items[0][price_data][product_data][name]": `EDK credits: ${cu.toLocaleString("en-US")} CU`,
      "line_items[0][price_data][product_data][description]": "Compute Units for the EDK API. Each CU covers five locations or areas.",
      "metadata[edk_user_id]": user.id,
      "metadata[units]": units,
      "payment_intent_data[metadata][edk_user_id]": user.id,
      success_url: `${siteUrl}/console/billing?checkout={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/console/billing?canceled=1`,
    }),
  });
  await recordPurchase(db, session.id, user.id, Math.round(dollars * 100), units);
  return session.url as string;
}

/** Credits a Checkout Session if it is paid and belongs to the user (when given). */
export async function settleCheckout(db: D1Database, sessionId: string, userId?: string) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return { credited: false, paid: false };
  const session = await stripe(`checkout/sessions/${sessionId}`);
  const owner = session?.metadata?.edk_user_id || session?.client_reference_id;
  const units = Number(session?.metadata?.units);
  if (!owner || (userId && owner !== userId) || !Number.isFinite(units) || units <= 0) return { credited: false, paid: false };
  if (session.payment_status !== "paid") return { credited: false, paid: false };
  const credited = await creditPurchase(db, session.id, owner, Number(session.amount_total) || 0, units);
  return { credited, paid: true, units };
}

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verifies a Stripe-Signature header (5-minute tolerance) and returns the parsed event. */
export async function verifyWebhook(payload: string, header: string | null, secret: string) {
  if (!header || !secret) return null;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return null;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  const signatures = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!signatures.some((s) => s.length === expected.length && timingSafeEqual(s, expected))) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
