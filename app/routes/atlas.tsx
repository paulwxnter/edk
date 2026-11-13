import type { Route } from "./+types/atlas";
import EmbedMap from "~/map/EmbedMap";

export const meta = () => [
  { title: "Atlas · EDK" },
  { name: "description", content: "Discover the world on the EDK Atlas: search places and features, and inspect the ground under any point. Free to use." },
];

export function loader({ request }: Route.LoaderArgs) {
  const q = (new URL(request.url).searchParams.get("q") || "").slice(0, 500);
  return { q, mapboxToken: process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null };
}

// The public Atlas on edk.earth. Free searches (limited per day) and inspections; embed.edk.earth
// serves the same Atlas to agents and other sites.
export default function Atlas({ loaderData }: Route.ComponentProps) {
  return <EmbedMap initialQuery={loaderData.q} mapboxToken={loaderData.mapboxToken} />;
}
