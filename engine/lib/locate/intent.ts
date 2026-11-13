// Cheap, deterministic reads of what a Find query is asking for. No model calls.

/** The question is about an amount or how it changes: totals, counts, growth, trends, comparisons. */
const AMOUNT = /\b(how many|how much|number of|count(s|ed)?|totals?|most|least|more|fewer|busiest|grow(s|ing|th)?|trend(s|ing)?|ris(e|es|ing)|increas(e|es|ed|ing)|decreas(e|es|ed|ing)|declin(e|es|ed|ing)|drop(s|ped|ping)?|fall(s|ing)?|spik(e|es|ed|ing)|surg(e|es|ed|ing)|chang(e|es|ed|ing)|compar(e|ed|ing|ison)|vs|versus|by (day|week|month|year)|per (day|week|month|year)|daily|weekly|monthly|yearly|annual(ly)?|over time|year over year|since \d{4})\b/i;

/** The question is about time (when, how recent), so dates are worth saying. */
const TIME = /\b(when|recent(ly)?|latest|newest|lately|last (week|month|year)|this (week|month|year)|since|ago|today|yesterday|20\d{2})\b/i;

export const asksAboutAmount = (query: string) => AMOUNT.test(query);
export const asksAboutTime = (query: string) => TIME.test(query) || AMOUNT.test(query);
