import { Link, redirect } from "react-router";
import type { Route } from "./+types/trends";
import { SiteLayout } from "~/components/chrome";
import { getSessionUser } from "../../server/auth";
import { hasSignalsAccess } from "../../server/signals-access";
import AsciiArt from "~/ascii/AsciiArt";
import TrendView from "~/trends/TrendView";
import TrendsSearch from "~/trends/TrendsSearch";
import { getAvailability, getCountryFor, getFallbackRegion, getModel, getPeers, getRegion, getRegionTypes, getSeries, getTopRegions } from "lib/signals/db";
import { DEFAULT_FEATURE_SLUG, DEFAULT_REGION_SLUG, TYPE_LABEL, compactNumber, isSeriesTimeframe, isWebTechCategoryMethod, regionLabel, regionTypesFor, type Point, type Region } from "lib/signals/types";

export function meta({ data }: Route.MetaArgs) {
  const description = data
    ? data.model.description ?? `${data.model.name} in ${regionLabel(data.region)}: volume, trend and how it compares with other places.`
    : "Signals from the physical world: permits, 311, collisions, mapped places and more, by place and over time.";
  return [{ title: data ? `${data.model.name} in ${regionLabel(data.region)} · Signals · EDK` : "Signals · EDK" }, { name: "description", content: description }];
}

const notFound = () => new Response("Not found", { status: 404 });

/**
 * One signal in one place, read entirely on the server so the first paint is the final one.
 * /signals shows the default signal; /signals/:feature/:region any other. Timeframe and region
 * comparisons then update in place on the client through /signals/api/*.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const featureSlug = params.feature ?? DEFAULT_FEATURE_SLUG;
  const regionSlug = params.region ?? DEFAULT_REGION_SLUG;
  const search = new URL(request.url).searchParams;

  const db = context.cloudflare.env.DB;
  const [model, found, user] = await Promise.all([getModel(featureSlug), getRegion(regionSlug), getSessionUser(db, request)]);
  const paid = user ? await hasSignalsAccess(db, user.id).catch(() => false) : false;
  if (!model) throw notFound();
  const { measurement } = model;
  const allowedTypes = regionTypesFor(model);
  const query = search.toString() ? `?${search}` : "";
  if (!found) {
    const fallback = await getFallbackRegion(model.featureId, measurement, allowedTypes);
    if (fallback) throw redirect(`/signals/${model.slug}/${fallback.slug}${query}`);
    throw notFound();
  }
  // Web technologies have no city or state data: any place resolves to its country.
  if (model.countryLevel && found.type !== "country") {
    const country = await getCountryFor(found);
    const target = country ?? (await getFallbackRegion(model.featureId, measurement, allowedTypes));
    if (target) throw redirect(`/signals/${model.slug}/${target.slug}${query}`);
  }
  const region: Region = found;

  const availability = await getAvailability(model.featureId, region.id, measurement);
  // Nothing recorded here: land on the place this signal is strongest.
  if (availability.total == null && availability.timeframes.length === 0) {
    const fallback = await getFallbackRegion(model.featureId, measurement, allowedTypes);
    if (fallback && fallback.slug !== region.slug) throw redirect(`/signals/${model.slug}/${fallback.slug}`);
  }

  const available = availability.timeframes;
  const timeframes = paid ? available : available.filter((frame) => frame === "year");
  const asked = search.get("tf");
  const wanted = isSeriesTimeframe(asked) && timeframes.includes(asked) ? asked : null;
  const tf = wanted ?? timeframes[0] ?? null;

  const regionTypes = (await getRegionTypes(model.featureId, measurement)).filter((t) => allowedTypes.includes(t));
  const initialType = regionTypes.includes(region.type) ? region.type : regionTypes[0] ?? "city";
  const vsSlugs = paid ? (search.get("vs") ?? "").split(",").filter((s) => s && s !== region.slug).slice(0, 4) : [];

  const [primary, compared, top, peers] = await Promise.all([
    tf ? getSeries(model.featureId, region.id, tf, measurement) : Promise.resolve([] as Point[]),
    tf
      ? Promise.all(
          vsSlugs.map(async (s) => {
            const r = await getRegion(s);
            return r ? { region: r, points: await getSeries(model.featureId, r.id, tf, measurement) } : null;
          })
        )
      : Promise.resolve([]),
    getTopRegions(model.featureId, initialType, 15, measurement),
    model.indicatorType ? getPeers(region.id, model.indicatorType, measurement, model.method).catch(() => []) : Promise.resolve([]),
  ]);

  const tracked = Boolean(tf && primary.length);
  return {
    model,
    region,
    total: availability.total,
    bench: availability.bench,
    paid,
    signedIn: Boolean(user),
    tf: tracked ? tf : null,
    timeframes: available,
    lines: [{ region, points: primary }, ...compared.filter((c): c is { region: Region; points: Point[] } => c !== null)],
    regionTypes: regionTypes.length ? regionTypes : [initialType],
    initialType,
    top,
    peers,
  };
}

export const headers = () => ({ "Cache-Control": "private, no-store" });

export default function Signals({ loaderData }: Route.ComponentProps) {
  const { model, region, total, bench, paid, tf, timeframes, lines, regionTypes, initialType, top, peers } = loaderData;
  const type = model.indicatorType ? TYPE_LABEL[model.indicatorType] : null;
  const tracked = tf !== null;

  return (
    <SiteLayout search={<TrendsSearch />}>
      <main className="trends-page">
        <section className="trends-hero">
          <div className="trends-hero-copy">
            <p className="trends-crumbs mono">
              <Link to="/signals">Signals</Link>
              {type && <> <span>/</span> {type.singular}</>}
            </p>
            <h1>{model.name}</h1>
            <p className="trends-where">
              in <strong>{regionLabel(region)}</strong>
            </p>
            {model.description && <p className="trends-desc">{model.description}</p>}
          </div>
          <div className="head-art art-host" aria-hidden="true">
            <AsciiArt art={[{ scene: "houses", x: 0.5, y: 0.55, size: 0.42 }]} />
          </div>
        </section>

        {total == null && !tracked && (
          <p className="trend-empty mono">
            No data available in this view for {regionLabel(region)}. Try another place.
          </p>
        )}
        <TrendView
          key={`${model.slug}:${region.slug}:${paid}:${tf}`}
          paid={paid}
          signedIn={loaderData.signedIn}
          model={model}
          region={region}
          timeframes={timeframes}
          initialTf={tf}
          initialLines={lines}
          total={total}
          bench={bench}
          regionTypes={regionTypes}
          initialType={initialType}
          initialTop={top}
        />

        {type && peers.length >= 2 && (
          <section className="trend-peers">
            <div className="trend-section-head">
              <div>
                <h2>{model.countryLevel ? `Other web ${isWebTechCategoryMethod(model.method) ? "technology categories" : "technologies"}` : `Other ${type.plural.toLowerCase()}`} in {region.name}</h2>
                <p>{model.countryLevel ? `HTTP Archive, latest snapshot: ${model.unit} on mobile.` : `${type.blurb}. All-time counts.`}</p>
              </div>
            </div>
            <ol>
              {(() => {
                const rows = peers.slice(0, 24);
                const max = Math.max(1, ...rows.map((p) => p.value));
                return rows.map((p, i) => (
                  <li key={p.slug} className={p.slug === model.slug ? "is-here" : undefined}>
                    <Link to={`/signals/${p.slug}/${region.slug}`}>
                      <span className="trend-rank-num mono">{String(i + 1).padStart(2, "0")}</span>
                      <span className="trend-rank-name">{p.name}</span>
                      <span className="trend-bar">
                        <span style={{ width: `${Math.max(2, (p.value / max) * 100)}%` }} />
                      </span>
                      <span className="trend-rank-value mono tabular">{compactNumber(p.value)}</span>
                    </Link>
                  </li>
                ));
              })()}
            </ol>
          </section>
        )}
      </main>
    </SiteLayout>
  );
}
