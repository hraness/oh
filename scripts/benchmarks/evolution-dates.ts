import { parseCanonicalInstantV1 } from "../../src/canonical";

/**
 * Strict, fail-closed parsing of the two benchmark timestamp grammars into
 * canonical UTC instants. Dataset timestamps carry no zone; the protocol card
 * declares the UTC assumption. Anything outside the two exact grammars (or a
 * canonical instant itself) is rejected rather than guessed.
 */
export const EVOLUTION_DATE_GRAMMARS = Object.freeze({
  longmemeval: "YYYY/MM/DD (Www) HH:MM",
  locomo: "H:MM am|pm on D Month, YYYY",
  canonical: "YYYY-MM-DDTHH:MM:SS.mmmZ",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"] as const;

function canonical(year: number, month: number, day: number, hour: number, minute: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) return null;
  return parseCanonicalInstantV1(instant.toISOString());
}

export function parseEvolutionInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return null;
  const direct = parseCanonicalInstantV1(value);
  if (direct !== null) return direct;
  const longmemeval = /^(\d{4})\/(\d{2})\/(\d{2}) \((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\) (\d{2}):(\d{2})$/u.exec(value);
  if (longmemeval !== null) {
    const [, year, month, day, weekday, hour, minute] = longmemeval;
    const instant = canonical(Number(year), Number(month), Number(day), Number(hour), Number(minute));
    if (instant === null || WEEKDAYS[new Date(instant).getUTCDay()] !== weekday) return null;
    return instant;
  }
  const locomo = /^(\d{1,2}):(\d{2}) (am|pm) on (\d{1,2}) ([A-Z][a-z]+), (\d{4})$/u.exec(value);
  if (locomo !== null) {
    const [, hour12, minute, meridiem, day, monthName, year] = locomo;
    const month = MONTHS.indexOf(monthName as typeof MONTHS[number]) + 1;
    const twelve = Number(hour12);
    if (month === 0 || twelve < 1 || twelve > 12) return null;
    const hour = (twelve % 12) + (meridiem === "pm" ? 12 : 0);
    return canonical(Number(year), month, Number(day), hour, Number(minute));
  }
  return null;
}

/** Throws for any timestamp outside the declared grammars. */
export function evolutionInstant(value: unknown, label: string): string {
  const instant = parseEvolutionInstant(value);
  if (instant === null) throw new TypeError(`Evolution ${label} is not a recognized benchmark timestamp.`);
  return instant;
}

/** An empty question date (LoCoMo) means no question instant; anything else must parse. */
export function evolutionQuestionInstant(questionDate: unknown): string | null {
  if (questionDate === "") return null;
  return evolutionInstant(questionDate, "question date");
}
