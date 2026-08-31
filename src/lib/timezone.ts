/**
 * Days are the store's days, not UTC's.
 *
 * A shop on GMT+1 that sells at 00:30 local made that sale at 23:30 UTC the previous
 * day. Bucketing on UTC would file it under yesterday, so "today" and every bar on
 * the daily chart would disagree with Shopify's own reports.
 *
 * Offsets are read from the IANA database rather than stored as a fixed number of
 * hours, so a zone that observes daylight saving stays correct through the change
 * instead of drifting by an hour for half the year.
 */

export const DEFAULT_TIME_ZONE = "UTC";

/** Falls back to UTC rather than throwing: a bad setting should not blank the dashboard. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInZone(date: Date, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const found = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

/**
 * How far the zone is from UTC at this instant, in milliseconds.
 *
 * Compared against the instant truncated to the second, because the formatted parts
 * carry no milliseconds — otherwise an end-of-day timestamp at .999 reports an offset
 * a second short and lands the boundary in the wrong day.
 */
function offsetAt(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const truncated = date.getTime() - date.getUTCMilliseconds();
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - truncated;
}

/** The calendar date in the store's zone, as YYYY-MM-DD. */
export function zonedDayKey(date: Date, timeZone: string): string {
  const p = partsInZone(date, safeTimeZone(timeZone));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * The instant a wall-clock time occurs in the zone.
 *
 * Applied twice: the first guess uses the offset at the wrong instant, which lands an
 * hour out across a daylight-saving boundary. Re-reading the offset at the corrected
 * instant settles it.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const zone = safeTimeZone(timeZone);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const firstPass = new Date(naive - offsetAt(new Date(naive), zone));
  return new Date(naive - offsetAt(firstPass, zone));
}

export function startOfZonedDay(dayKey: string, timeZone: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return zonedTimeToUtc(timeZone, year, month, day, 0, 0, 0, 0);
}

export function endOfZonedDay(dayKey: string, timeZone: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return zonedTimeToUtc(timeZone, year, month, day, 23, 59, 59, 999);
}

/** Today's date in the store's zone — the anchor every relative range counts back from. */
export function todayInZone(timeZone: string): string {
  return zonedDayKey(new Date(), timeZone);
}

/** Calendar arithmetic on the key itself, so it cannot be knocked off by an offset change. */
export function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}
