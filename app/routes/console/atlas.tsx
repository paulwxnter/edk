import type { Route } from "./+types/atlas";
import { useRevalidator } from "react-router";
import EmbedMap from "~/map/EmbedMap";
import { nextTier } from "~/lib/tiers";
import { getSessionUser } from "../../../server/auth";
import { spendable } from "../../../server/store";

const ATLAS_BODY = { source: "atlas" };

export const meta = () => [{ title: "Atlas · EDK Console" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  const user = await getSessionUser(db, request);
  const account = user ? await spendable(db, user.id).catch(() => null) : null;
  return {
    mapboxToken: process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null,
    upgrade: account ? Boolean(nextTier(account.tier)) : true,
  };
}

// The same map as embed.edk.earth, searching with your account (billed like the playground).
export default function ConsoleAtlas({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  return (
    <div className="atlas-page">
      <EmbedMap contained searchUrl="/console/api/discover" inspectUrl="/console/api/inspect" routeUrl="/console/api/route" extraBody={ATLAS_BODY} mapboxToken={loaderData.mapboxToken} upgradeUrl={loaderData.upgrade ? "/console/billing" : null} onResult={() => revalidator.revalidate()} />
    </div>
  );
}
