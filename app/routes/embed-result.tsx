import { redirect } from "react-router";
import type { Route } from "./+types/embed-result";
import EmbedMap from "~/map/EmbedMap";
import { getResult } from "../../server/store";
import { openResult } from "../../server/embed";
import { publicStoredDiscover } from "../../server/shape";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data && "data" in data && data.data ? `${data.data.query} · EDK Atlas` : "EDK Atlas" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Stored results live on the embed host.
  if (!url.hostname.startsWith("embed.") && !import.meta.env.DEV && !url.hostname.includes("localhost")) {
    throw redirect(`https://embed.edk.earth/r/${params.id}`);
  }
  const db = context.cloudflare.env.DB;
  const row = await getResult(db, params.id);
  if (!row) throw new Response("Not found", { status: 404 });
  const mapboxToken = process.env.MAPBOX_API_KEY?.startsWith("pk.") ? process.env.MAPBOX_API_KEY : null;
  // Each load is billed to the result's owner and capped per day.
  const opened = await openResult(db, row, request.headers.get("cf-connecting-ip") || "local");
  if ("error" in opened) return { id: row.id, data: null, error: opened.error ?? "This map is unavailable.", mapboxToken };
  return { id: row.id, data: publicStoredDiscover(row.payload), error: null, mapboxToken };
}

// A shared result: read-only. Searching needs an embed key.
export default function EmbedResult({ loaderData }: Route.ComponentProps) {
  return <EmbedMap initialResult={loaderData.data ? { id: loaderData.id, data: loaderData.data } : null} keyError={loaderData.error} mapboxToken={loaderData.mapboxToken} readOnly />;
}
