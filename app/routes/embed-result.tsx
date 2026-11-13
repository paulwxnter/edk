import { redirect } from "react-router";
import type { Route } from "./+types/embed-result";
import EmbedMap from "~/map/EmbedMap";
import { getResult } from "../../server/store";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.data.query} · EDK Atlas` : "EDK Atlas" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Stored results live on the embed host.
  if (!url.hostname.startsWith("embed.") && !import.meta.env.DEV && !url.hostname.includes("localhost")) {
    throw redirect(`https://embed.edk.earth/r/${params.id}`);
  }
  const row = await getResult(context.cloudflare.env.DB, params.id);
  if (!row) throw new Response("Not found", { status: 404 });
  const mapboxToken = process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null;
  return { id: row.id, data: row.payload, mapboxToken };
}

export default function EmbedResult({ loaderData }: Route.ComponentProps) {
  return <EmbedMap initialResult={{ id: loaderData.id, data: loaderData.data }} mapboxToken={loaderData.mapboxToken} />;
}
