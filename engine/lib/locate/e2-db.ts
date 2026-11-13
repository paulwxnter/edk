import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";

// On Workers a socket belongs to the request that opened it, so each request gets its own client
// (opened on first use, closed when the request ends). Run request work inside withDb().
type Client = ReturnType<typeof postgres>;
type Slot = { client?: Client };
const scope = new AsyncLocalStorage<Slot>();

export async function withDb<T>(fn: () => Promise<T>, waitUntil?: (p: Promise<unknown>) => void): Promise<T> {
  const slot: Slot = {};
  return scope.run(slot, async () => {
    try {
      return await fn();
    } finally {
      const client = slot.client;
      if (client) {
        const closing = client.end({ timeout: 5 }).catch(() => {});
        if (waitUntil) waitUntil(closing);
        else await closing;
      }
    }
  });
}

function client(): Client {
  const slot = scope.getStore();
  if (!slot) throw new Error("Database used outside withDb().");
  if (!slot.client) {
    const connectionString = process.env.NEON_DB_URL;
    if (!connectionString) throw new Error("NEON_DB_URL is not configured.");
    // Workers allow six open connections per request.
    slot.client = postgres(connectionString, { max: 5, connect_timeout: 10, ssl: "require", onnotice: () => {} });
  }
  return slot.client;
}

export const sql = {
  query: (query: string, params: unknown[] = []) => client().unsafe(query, params as any[]),
  transaction: <T>(callback: (tx: { query: (query: string, params?: unknown[]) => ReturnType<Client["unsafe"]> }) => Promise<T>) =>
    client().begin((tx) => callback({ query: (query: string, params: unknown[] = []) => tx.unsafe(query, params as any[]) })) as Promise<T>,
  // A transaction with a server-side statement timeout (SET LOCAL is transaction-scoped).
  withTimeout: <T>(ms: number, callback: (tx: { query: (query: string, params?: unknown[]) => ReturnType<Client["unsafe"]> }) => Promise<T>) =>
    client().begin(async (tx) => {
      const q = (query: string, params: unknown[] = []) => tx.unsafe(query, params as any[]);
      await q(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(Number(ms) || 25000))}`);
      return callback({ query: q });
    }) as Promise<T>,
};
