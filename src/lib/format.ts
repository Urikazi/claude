import {
  DEFAULT_TIME_ZONE,
  addDays,
  daysBetween,
  endOfZonedDay,
  safeTimeZone,
  startOfZonedDay,
  todayInZone,
} from "@/lib/timezone";

export function formatMoney(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/// Resolves the `?range=` query param into an inclusive UTC day range.
export type Range = {
  from: Date;
  to: Date;
  days: number;
  label: string;
  /** The store's zone, carried through so day buckets match the range boundaries. */
  timeZone: string;
};

function parseDay(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * `range` is a preset name; `from`/`to` are ISO days that override it. Boundaries are
 * the store's own midnights, so a day here is the same day Shopify reports.
 *
 * A custom range with only one end still resolves, anchored to today, so a
 * half-filled date picker shows something rather than looking broken.
 */
export function resolveRange(
  range?: string,
  from?: string,
  to?: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): Range {
  const zone = safeTimeZone(timeZone);
  const today = todayInZone(zone);
  const customFrom = parseDay(from);
  const customTo = parseDay(to);

  if (customFrom || customTo) {
    let startKey = customFrom ?? customTo ?? today;
    let endKey = customTo ?? customFrom ?? today;
    // Reversed inputs are a slip, not an empty range.
    if (startKey > endKey) [startKey, endKey] = [endKey, startKey];
    return {
      from: startOfZonedDay(startKey, zone),
      to: endOfZonedDay(endKey, zone),
      days: daysBetween(startKey, endKey),
      label: startKey === endKey ? startKey : `${startKey} to ${endKey}`,
      timeZone: zone,
    };
  }

  const presets: Record<string, { days: number; label: string; endsYesterday?: boolean }> = {
    today: { days: 1, label: "Today" },
    yesterday: { days: 1, label: "Yesterday", endsYesterday: true },
    "7d": { days: 7, label: "Last 7 days" },
    "30d": { days: 30, label: "Last 30 days" },
    "90d": { days: 90, label: "Last 90 days" },
  };
  const preset = presets[range ?? "30d"] ?? presets["30d"];

  const endKey = preset.endsYesterday ? addDays(today, -1) : today;
  const startKey = addDays(endKey, -(preset.days - 1));

  return {
    from: startOfZonedDay(startKey, zone),
    to: endOfZonedDay(endKey, zone),
    days: preset.days,
    label: preset.label,
    timeZone: zone,
  };
}
