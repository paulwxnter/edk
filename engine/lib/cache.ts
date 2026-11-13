// Stand-in for Next's unstable_cache on Workers: an in-isolate memo with a TTL. Only settled values
// are kept (never a pending promise), since a Worker must not await I/O started by another request.
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();
const MAX_ENTRIES = 2000;

export function unstable_cache<A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[] = [], options: { revalidate?: number; tags?: string[] } = {}) {
  const ttl = (options.revalidate ?? 3600) * 1000;
  return async (...args: A): Promise<R> => {
    const key = `${keyParts.join(":")}|${JSON.stringify(args)}`;
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as R;
    const value = await fn(...args);
    if (store.size >= MAX_ENTRIES) store.clear();
    store.set(key, { value, expires: Date.now() + ttl });
    return value;
  };
}
