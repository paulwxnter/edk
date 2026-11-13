import type { Route } from "./+types/atlas";
import { useRevalidator } from "react-router";
import EmbedMap from "~/map/EmbedMap";

const ATLAS_BODY = { source: "atlas" };

export const meta = () => [{ title: "Atlas · EDK Console" }];

export function loader() {
  return { mapboxToken: process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null };
}

// The same map as embed.edk.earth, searching with your account (billed like the playground).
export default function ConsoleAtlas({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  return (
    <div className="atlas-page">
      <EmbedMap contained searchUrl="/console/api/search" inspectUrl="/console/api/inspect" extraBody={ATLAS_BODY} mapboxToken={loaderData.mapboxToken} onResult={() => revalidator.revalidate()} />
    </div>
  );
}
