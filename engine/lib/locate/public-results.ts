import { mediaProxyUrl } from "./media-proxy";
const HIDDEN_PUBLIC_PROPERTY_KEYS = new Set([
  "$dist",
  "dist",
  "distance",
  "engine",
  "source_id",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "lon",
  "captured_at",
  "capturedat",
  "visual_url",
  "h3_id",
  "h3_r1",
  "h3_r2",
  "h3_r3",
  "h3_r4",
  "h3_r5",
  "h3_r6",
  "h3_r7",
  "h3_r8",
  "h3_r9",
  "h3_r15",
  "s_index",
  "season",
  "time_of_day",
  "timeofday",
  "region",
  "region_id",
  "timings",
  "query_duration_ms",
  "duration_seconds",
  "is_pano",
  "artifact_type",
]);

function publicKey(key: string) {
  return key.toLowerCase().replace(/[\s-]+/g, "_");
}

export function publicGeoJson(collection: any) {
  const features = Array.isArray(collection?.features)
    ? collection.features
    : [];
  return {
    type: "FeatureCollection",
    features: features.map((feature: any) => {
      const properties = feature?.properties || {};
      const cleanProperties: Record<string, unknown> = {};
      let capturedAt = properties.captured_at;
      const interactive =
        properties.interactive === true || properties.is_pano === true;
      const visualUrl = properties.visual_url;
      for (const [key, value] of Object.entries(properties)) {
        const normalizedKey = publicKey(key);
        if (normalizedKey === "captured_at" || normalizedKey === "capturedat") {
          capturedAt = value;
        }
        if (!HIDDEN_PUBLIC_PROPERTY_KEYS.has(normalizedKey)) {
          const publicValue =
            normalizedKey === "video_url" || normalizedKey === "videourl"
              ? mediaProxyUrl(value, "video")
              : value;
          cleanProperties[normalizedKey === "sequence_id" ? "video_id" : key] = publicValue;
        }
      }
      if (visualUrl !== null && visualUrl !== undefined) {
        cleanProperties.image_url = mediaProxyUrl(visualUrl, "image");
      }
      cleanProperties.interactive = interactive;
      if (
        capturedAt !== null &&
        capturedAt !== undefined &&
        !cleanProperties.date
      ) {
        cleanProperties.date = capturedAt;
      }
      return {
        type: "Feature",
        ...(feature?.id === undefined ? {} : { id: String(feature.id) }),
        geometry: feature?.geometry || null,
        properties: cleanProperties,
      };
    }),
  };
}


