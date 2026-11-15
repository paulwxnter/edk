import { useMemo } from "react";
import { redirect, useRevalidator } from "react-router";
import type { Route } from "./+types/atlas";
import EmbedMap from "~/map/EmbedMap";
import { nextTier, reasoningAllowed, reasoningById } from "~/lib/tiers";
import { getSessionUser } from "../../server/auth";
import { publicStoredDiscover } from "../../server/shape";
import { getResult, spendable } from "../../server/store";

export const meta = () => [
  { title: "Atlas · EDK" },
  { name: "description", content: "The EDK Atlas: find places and features, understand the ground under any point, and route from A to B." },
];

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  if (!user) throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const q = (url.searchParams.get("q") || "").slice(0, 500);
  const account = await spendable(db, user.id);
  // /atlas/:id opens a result this account made before, so a refresh or a shared tab comes back to it.
  let result: { id: string; data: ReturnType<typeof publicStoredDiscover> } | null = null;
  if (params.id) {
    const row = await getResult(db, params.id);
    if (!row || row.user_id !== user.id) throw redirect("/atlas");
    result = { id: row.id, data: publicStoredDiscover(row.payload) };
  }
  // A level above the account's tier falls back to the default instead of failing the search.
  const asked = reasoningById(url.searchParams.get("reasoning"));
  const reasoning = asked && reasoningAllowed(account.tier, asked.id) ? asked.id : null;
  return { q, result, reasoning, upgrade: Boolean(nextTier(account.tier)), balance: account.balance, mapboxToken: process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null };
}

// The Atlas on edk.earth: signed in, and billed to the account in CU like the console.
export default function Atlas({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const body = useMemo(() => ({ source: "atlas", ...(loaderData.reasoning ? { reasoning: loaderData.reasoning } : {}) }), [loaderData.reasoning]);
  return (
    <EmbedMap
      key={loaderData.result?.id ?? "atlas"}
      initialQuery={loaderData.result ? "" : loaderData.q}
      initialResult={loaderData.result as never}
      resultPath="/atlas"
      mapboxToken={loaderData.mapboxToken}
      balanceUnits={loaderData.balance}
      upgradeUrl={loaderData.upgrade ? "/console/billing" : null}
      extraBody={body}
      onResult={() => revalidator.revalidate()}
    />
  );
}
