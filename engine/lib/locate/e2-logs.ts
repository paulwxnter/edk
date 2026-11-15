import { sql } from "./e2-db";
import type { TokenTally } from "./tokens";

export type StageTiming = { stage: string; ms: number };

export type RoutingProvider = "jev" | "gateway_jev" | "openai_decision" | "cerebras" | "luna" | "artifact_method";

export type RoutingAttempt = {
  provider: RoutingProvider;
  model: string | null;
  status: "ok" | "error";
  routed: boolean;
  duration_ms: number;
  http_status?: number | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
};

export type RoutingTrace = {
  selected_provider: RoutingProvider | null;
  selected_model: string | null;
  selected_artifact: string | null;
  selected_region_ids: string[];
  selected_year: string | null;
  answer: boolean;
  safety: boolean;
  attempts: RoutingAttempt[];
  /** Private request decisions and execution outcome, retained in stream_logs only. */
  diagnostics?: Record<string, unknown>;
  /** Separate route passes, including retries and fallback searches. */
  run_history?: Array<Record<string, unknown>>;
};

export type SearchLogStatus = "running" | "ok" | "error" | "blocked";

export type SearchLogEntry = {
  query: string;
  resultId?: string | null;
  status: SearchLogStatus;
  error?: string | null;
  regionId?: string | null;
  regionName?: string | null;
  featureNames?: string[];
  resultCount?: number;
  durationMs?: number;
  stages?: StageTiming[];
  routingTrace?: RoutingTrace | null;
  /** Decision and answer tokens used by this search. */
  tokens?: TokenTally | null;
  answer?: string | null;
};

let initialized = false;

// Lazily create the dedicated stream_logs table; logging must never break a
// request. This is a fresh table for the v1/stream engine, separate from the
// legacy search_logs table the old E2 engine wrote.
export async function ensureLogsTable(): Promise<void> {
  if (initialized) return;
  try {
    await sql.query(`
      create table if not exists stream_logs (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        query text not null,
        result_id text,
        status text not null default 'ok',
        error text,
        region_id text,
        region_name text,
        feature_names text[],
        result_count integer not null default 0,
        duration_ms integer not null default 0,
        stage_timings jsonb not null default '{}'::jsonb,
        routing_trace jsonb not null default '{}'::jsonb
      )
    `);
    // The table predates provider-level routing telemetry in production.
    // Keep this lazy and additive so existing rows and deployments survive.
    await sql.query(
      "alter table stream_logs add column if not exists routing_trace jsonb not null default '{}'::jsonb",
    );
    await sql.query("alter table stream_logs add column if not exists source text");
    await sql.query("alter table stream_logs add column if not exists updated_at timestamptz");
    // Token use per search: input tokens of every decision call (JEV or its fallback), and the answer's input and output.
    await sql.query("alter table stream_logs add column if not exists decision_tokens integer not null default 0");
    await sql.query("alter table stream_logs add column if not exists decision_calls integer not null default 0");
    await sql.query("alter table stream_logs add column if not exists answer_input_tokens integer not null default 0");
    await sql.query("alter table stream_logs add column if not exists answer_output_tokens integer not null default 0");
    // Who asked (signed-in user, else an anonymous browser session) and what was answered: the context engine reads these.
    await sql.query("alter table stream_logs add column if not exists user_id text");
    await sql.query("alter table stream_logs add column if not exists session_id text");
    await sql.query("alter table stream_logs add column if not exists answer text");
    await sql.query("create index if not exists stream_logs_user_idx on stream_logs (user_id, created_at desc) where user_id is not null");
    await sql.query("create index if not exists stream_logs_session_idx on stream_logs (session_id, created_at desc) where session_id is not null");
    await sql.query(
      "create index if not exists stream_logs_created_at_idx on stream_logs (created_at desc)"
    );
    initialized = true;
  } catch (error) {
    console.error("[stream-logs] table initialization failed:", error);
  }
}

// Fire-and-forget insert; failures are swallowed so requests never fail
// because of logging.
export async function logSearch(entry: SearchLogEntry): Promise<void> {
  try {
    await ensureLogsTable();
    await sql.query(
      `insert into stream_logs
         (query, result_id, status, error, region_id, region_name, feature_names, result_count, duration_ms, stage_timings, routing_trace)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      [
        entry.query,
        entry.resultId ?? null,
        entry.status,
        entry.error ?? null,
        entry.regionId ?? null,
        entry.regionName ?? null,
        entry.featureNames ?? [],
        entry.resultCount ?? 0,
        Math.round(entry.durationMs ?? 0),
        JSON.stringify(entry.stages ?? []),
        JSON.stringify(entry.routingTrace ?? {}),
      ],
    );
  } catch (error) {
    console.error("[stream-logs] insert failed:", error);
  }
}

/**
 * A stream_logs row written the moment a query arrives (status "running") and updated as each stage
 * starts and ends, then once more when the search finishes. A request killed by the platform timeout
 * therefore still leaves a row showing which stages finished and which one was still running.
 * Writes run one after another on a chain; a failed write is logged and never breaks the request.
 */
export class SearchLog {
  readonly id = crypto.randomUUID();
  private chain: Promise<unknown>;
  private done = false;
  private progressQueued = false;
  private routingQueued = false;

  constructor(readonly query: string, readonly source: string, private readonly timer: QueryTimer, who: { userId?: string | null; sessionId?: string | null } = {}) {
    this.chain = this.run(async () => {
      await ensureLogsTable();
      await sql.query(
        "insert into stream_logs (id, query, status, source, user_id, session_id, updated_at) values ($1::uuid, $2, 'running', $3, $4, $5, now())",
        [this.id, query, source, who.userId ?? null, who.sessionId ?? null],
      );
    });
    timer.onChange = () => this.progress();
    timer.onRoutingChange = () => this.progressRouting();
  }

  private run(fn: () => Promise<unknown>) {
    const next = (this.chain ?? Promise.resolve()).then(fn).catch((error) => console.error("[stream-logs] write failed:", error instanceof Error ? error.message : error));
    this.chain = next;
    return next;
  }

  /** Stages so far, including the ones still running. Skipped once finished. */
  private progress() {
    // One write waits at a time and reads the stages when it runs: a write per stage start and end would
    // queue dozens of round trips that the final write, and so the response, has to wait behind.
    if (this.done || this.progressQueued) return;
    this.progressQueued = true;
    void this.run(async () => {
      this.progressQueued = false;
      if (this.done) return;
      await sql.query(
        "update stream_logs set stage_timings = $2::jsonb, duration_ms = $3, updated_at = now() where id = $1::uuid and status = 'running'",
        [this.id, JSON.stringify(this.timer.snapshot()), this.timer.totalMs()],
      );
    });
  }

  /** Persist routing changes independently of timer ticks to keep progress writes light. */
  private progressRouting() {
    if (this.done || this.routingQueued) return;
    this.routingQueued = true;
    void this.run(async () => {
      this.routingQueued = false;
      if (this.done) return;
      await sql.query(
        "update stream_logs set routing_trace = $2::jsonb, updated_at = now() where id = $1::uuid and status = 'running'",
        [this.id, JSON.stringify(this.timer.routingTrace() ?? {})],
      );
    });
  }

  /** Final state. Await it before responding so the row is complete. */
  finish(entry: Omit<SearchLogEntry, "query" | "stages" | "durationMs">): Promise<unknown> {
    this.done = true;
    this.timer.onChange = undefined;
    this.timer.onRoutingChange = undefined;
    const stages = this.timer.snapshot();
    const ms = this.timer.totalMs();
    const routingTrace = this.timer.routingTrace() ?? entry.routingTrace ?? {};
    return this.run(() => sql.query(
      `update stream_logs
          set status = $2, error = $3, result_id = $4, region_id = $5, region_name = $6, feature_names = $7,
              result_count = $8, duration_ms = $9, stage_timings = $10::jsonb, routing_trace = $11::jsonb,
              decision_tokens = $12, decision_calls = $13, answer_input_tokens = $14, answer_output_tokens = $15, answer = $16, updated_at = now()
        where id = $1::uuid`,
      [
        this.id,
        entry.status,
        entry.error ? String(entry.error).slice(0, 500) : null,
        entry.resultId ?? null,
        entry.regionId ?? null,
        entry.regionName ?? null,
        entry.featureNames ?? [],
        entry.resultCount ?? 0,
        Math.round(ms),
        JSON.stringify(stages),
        JSON.stringify(routingTrace),
        entry.tokens?.decisionInput ?? 0,
        entry.tokens?.decisionCalls ?? 0,
        entry.tokens?.answerInput ?? 0,
        entry.tokens?.answerOutput ?? 0,
        entry.answer ? String(entry.answer).slice(0, 2000) : null,
      ],
    ));
  }
}

/** Per-request stage stopwatch. */
export class QueryTimer {
  readonly startedAt = Date.now();
  private stages: StageTiming[] = [];
  private marks: Record<string, number> = {};
  private routeTrace: RoutingTrace | null = null;
  /** Called whenever a stage starts or ends (SearchLog uses it to keep the row current). */
  onChange?: () => void;
  /** Called when decisions change so SearchLog can persist them without duplicating timer payloads. */
  onRoutingChange?: () => void;

  mark(stage: string): void {
    this.marks[stage] = Date.now();
    this.onChange?.();
  }

  end(stage: string): void {
    const started = this.marks[stage];
    if (started === undefined) return;
    this.stages.push({ stage, ms: Date.now() - started });
    delete this.marks[stage];
    this.onChange?.();
  }

  /** Finished stages plus the ones still running (with time so far). */
  snapshot(): Array<StageTiming & { running?: true }> {
    const now = Date.now();
    return [...this.stages, ...Object.entries(this.marks).map(([stage, started]) => ({ stage, ms: now - started, running: true as const }))];
  }

  async stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.mark(name);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }

  record(stage: string, ms: number): void {
    this.stages.push({ stage, ms });
    this.onChange?.();
  }

  /** Begin a routing pass so timeouts and mid-flight logs retain the choices made so far. */
  beginRoutingTrace(trace: RoutingTrace): void {
    const snapshot = structuredClone(trace);
    const diagnostics = { ...(this.routeTrace?.diagnostics ?? {}), ...(snapshot.diagnostics ?? {}) };
    const current = { ...snapshot, diagnostics };
    const history = [...(this.routeTrace?.run_history ?? []), structuredClone(current)];
    this.routeTrace = { ...current, run_history: history };
    this.onRoutingChange?.();
  }

  /** Refresh the active routing pass after a provider attempt or a decision update. */
  updateRoutingTrace(trace: RoutingTrace): void {
    if (!this.routeTrace) {
      this.beginRoutingTrace(trace);
      return;
    }
    const current = { ...this.routeTrace, ...structuredClone(trace) };
    const history = [...(this.routeTrace.run_history ?? [])];
    if (history.length) history[history.length - 1] = { ...history[history.length - 1], ...structuredClone(trace) };
    this.routeTrace = { ...current, run_history: history };
    this.onRoutingChange?.();
  }

  /** Append decision and execution details to the active private routing record. */
  updateRoutingDiagnostics(patch: Record<string, unknown>): void {
    const base: RoutingTrace = this.routeTrace ?? {
      selected_provider: null, selected_model: null, selected_artifact: null,
      selected_region_ids: [], selected_year: null, answer: false, safety: false, attempts: [],
    };
    const diagnostics = { ...(base.diagnostics ?? {}), ...structuredClone(patch) };
    const history = [...(base.run_history ?? [])];
    if (history.length) history[history.length - 1] = { ...history[history.length - 1], diagnostics: { ...((history[history.length - 1].diagnostics as Record<string, unknown> | undefined) ?? {}), ...structuredClone(patch) } };
    this.routeTrace = { ...base, diagnostics, run_history: history };
    this.onRoutingChange?.();
  }

  routingTrace(): RoutingTrace | null {
    return this.routeTrace ? structuredClone(this.routeTrace) : null;
  }

  all(): StageTiming[] {
    return [...this.stages];
  }

  totalMs(): number {
    return Date.now() - this.startedAt;
  }

  durationSeconds(): number {
    return Math.round((this.totalMs() / 1000) * 10) / 10;
  }
}
