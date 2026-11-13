// Trends: the ledger's counts over time for the features a search matched, in the region it ran in.
import { getAvailability, getSeries } from "lib/signals/db";

export type TrendSeries = {
  name: string;
  slug: string | null;
  icon_url: string | null;
  total: number | null;
  /** Points per timeframe; only the ones the ledger holds. */
  year?: { date: string; value: number }[];
  monthly?: { date: string; value: number }[];
  weekly?: { date: string; value: number }[];
};

export type Trends = { region: { id: string; name: string; slug: string | null }; series: TrendSeries[] };

type TrendArtifact = { name: string; slug: string | null; icon_url: string | null; feature_id: string | null };

/** Up to three features' series. Null when the ledger has nothing to plot. */
export async function loadTrends(artifacts: TrendArtifact[], region: { id: string; name: string; slug: string | null } | null): Promise<Trends | null> {
  if (!region || !/^\d+$/.test(region.id)) return null;
  const wanted = artifacts.filter((a) => a.feature_id && /^\d+$/.test(a.feature_id)).slice(0, 3);
  if (!wanted.length) return null;
  const regionId = Number(region.id);
  const series = await Promise.all(
    wanted.map(async (a): Promise<TrendSeries | null> => {
      try {
        const featureId = Number(a.feature_id);
        const available = await getAvailability(featureId, regionId);
        if (!available.timeframes.length) return null;
        const loaded = await Promise.all(available.timeframes.map(async (tf) => [tf, await getSeries(featureId, regionId, tf)] as const));
        return { name: a.name, slug: a.slug, icon_url: a.icon_url, total: available.total, ...Object.fromEntries(loaded.filter(([, points]) => points.length >= 2)) };
      } catch {
        return null;
      }
    }),
  );
  const kept = series.filter((s): s is TrendSeries => Boolean(s && (s.year || s.monthly || s.weekly)));
  return kept.length ? { region, series: kept } : null;
}
