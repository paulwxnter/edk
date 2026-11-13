// The context engine: before a search is answered, the asker's last 40 searches are reviewed and JEV
// decides which of them the current question leans on (a follow-up, the same subject, a comparison).
// The few that matter are handed to the answer engine, in order, with when they were asked.
import { sql } from "./e2-db";
import { ensureLogsTable } from "./e2-logs";
import { decide } from "./jev";

export const CONTEXT_WINDOW = 40;
const MAX_PICKED = 4;
const RELEVANT = 0.6;

export type Asker = { userId: string | null; sessionId: string | null };

export type PastChat = {
  /** 1 = the oldest of the reviewed messages; higher is more recent. */
  order: number;
  at: string;
  /** "Tue, Nov 11, 3:42 PM" in the asker's time zone. */
  when: string;
  query: string;
  place: string | null;
  features: string[];
  results: number;
  answer: string | null;
  /** JEV's relevance to the current question, 0 to 1. */
  relevance?: number;
};

function whenText(date: Date, timeZone: string) {
  const format = (tz: string) => date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" });
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

function ago(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  if (minutes < 60 * 36) return `${Math.round(minutes / 60)} hours ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

/** The asker's most recent finished searches, oldest first, numbered in the order they were asked. */
export async function recentChats(who: Asker, excludeLogId: string | null, timeZone: string, limit = CONTEXT_WINDOW): Promise<PastChat[]> {
  if (!who.userId && !who.sessionId) return [];
  await ensureLogsTable();
  const rows = (await sql.query(
    `select created_at, query, region_name, feature_names, result_count, answer
     from stream_logs
     where status = 'ok' and source = 'outerview' and ${who.userId ? "user_id = $1" : "session_id = $1"} and ($2::uuid is null or id <> $2::uuid)
     order by created_at desc limit $3`,
    [who.userId ?? who.sessionId, excludeLogId, limit],
  )) as any[];
  return rows.reverse().map((r, i) => {
    const at = new Date(r.created_at);
    return {
      order: i + 1,
      at: at.toISOString(),
      when: whenText(at, timeZone),
      query: String(r.query),
      place: r.region_name ? String(r.region_name) : null,
      features: Array.isArray(r.feature_names) ? r.feature_names.map(String).slice(0, 4) : [],
      results: Number(r.result_count) || 0,
      answer: r.answer ? String(r.answer) : null,
    };
  });
}

const RULES = [
  "You are the context gate of Outerview, a geographic search engine people use like a conversation.",
  "You see the CURRENT question, the time now, and the same person's EARLIER messages in the order they were asked (number 1 is the oldest), each with the date and time it was asked, how long ago that was, the place it was about and what it looked for.",
  "For each earlier message, decide whether the answer to the current question should take it into account.",
  "It should when the current question is a follow-up that leans on it: it uses 'those', 'them', 'there', 'that area', 'what about…', 'and last year?', 'same for…', 'compare', or leaves out a subject or a place that the earlier message supplies.",
  "It should when the current question is about the same thing in the same place, or the same thing in another place (a comparison the answer can mention).",
  "It should not when the two merely share a broad theme, or are about different things in different places. A complete, self-contained question about something new needs no earlier message.",
  "Words that point back without naming anything ('the same thing', 'those', 'them', 'it', 'that', 'what about…') refer to the subject of the MOST RECENT earlier message, the one with the highest number. When the current question points back like that, the most recent message is relevant and older messages about a different subject are not.",
  "Follow-ups nearly always refer to the most recent messages, asked minutes ago; a message from days ago is rarely what 'those' refers to.",
].join(" ");

/**
 * The earlier messages the current question leans on: up to four, oldest first. Empty when there is
 * no history, nothing is relevant, or no decision model answers in time.
 */
export async function relevantContext(query: string, who: Asker, excludeLogId: string | null, timeZone = "UTC"): Promise<{ picked: PastChat[]; reviewed: number }> {
  const chats = await recentChats(who, excludeLogId, timeZone).catch(() => [] as PastChat[]);
  if (!chats.length) return { picked: [], reviewed: 0 };
  const now = new Date();
  const state = {
    rules: RULES,
    now: whenText(now, timeZone),
    current_question: query,
    earlier_messages: chats.map((c) => ({
      number: c.order,
      asked_at: c.when,
      asked: ago(now.getTime() - new Date(c.at).getTime()),
      position: c.order === chats.length ? "the most recent earlier message" : `${chats.length - c.order} message(s) were asked after this one`,
      question: c.query,
      place: c.place ?? "(no place named)",
      looked_for: c.features.join(", ") || "(unknown)",
    })),
  };
  const questions = Object.fromEntries(
    chats.map((c) => [
      `message:${c.order}`,
      {
        type: "noul",
        instructions: `Should the answer to the current question take earlier message number ${c.order} into account? It is ${c.order === chats.length ? "the most recent earlier message" : `an older message (${chats.length - c.order} asked after it)`}. It was asked ${state.earlier_messages[c.order - 1].asked} (${c.when}): "${c.query.slice(0, 200)}"${c.place ? `, about ${c.place}` : ""}. Judge only this message, using the rules in the state.`,
        criteria: {
          true: "The current question is a follow-up to this message, or asks about the same thing (in the same or a compared place), so the answer should build on it.",
          false: "This message is unrelated to the current question, or adds nothing the answer needs.",
        },
      },
    ]),
  );
  const result = await decide(questions, state, 3500).catch(() => null);
  if (!result) return { picked: [], reviewed: chats.length };
  const scored = chats
    .map((c) => ({ ...c, relevance: Number(result.answers[`message:${c.order}`]?.noul) || 0 }))
    .filter((c) => c.relevance >= RELEVANT)
    // The same question asked twice counts once: keep the latest.
    .filter((c, _, all) => !all.some((o) => o.order > c.order && o.query.trim().toLowerCase() === c.query.trim().toLowerCase()))
    // Most relevant first; between equals, the more recent.
    .sort((a, b) => b.relevance - a.relevance || b.order - a.order)
    .slice(0, MAX_PICKED)
    .sort((a, b) => a.order - b.order);
  console.log(JSON.stringify({ event: "context_gate", provider: result.provider, reviewed: chats.length, picked: scored.map((c) => ({ n: c.order, r: +c.relevance.toFixed(2) })) }));
  return { picked: scored, reviewed: chats.length };
}
