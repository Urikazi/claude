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
export type Range = { from: Date; to: Date; days: number; label: string };

/** Whole UTC days, so a range never straddles part of one. */
function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

function endOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

const DAY_MS = 86_400_000;

function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `range` is a preset name; `from`/`to` are ISO days that override it. A custom range
 * with only one end still resolves, anchored to today, so a half-filled date picker
 * shows something rather than falling back and looking broken.
 */
export function resolveRange(range?: string, from?: string, to?: string): Range {
  const customFrom = parseDay(from);
  const customTo = parseDay(to);

  if (customFrom || customTo) {
    const today = new Date();
    let start = startOfDay(customFrom ?? customTo ?? today);
    let end = endOfDay(customTo ?? customFrom ?? today);
    // Reversed inputs are a slip, not an empty range.
    if (start > end) [start, end] = [startOfDay(end), endOfDay(start)];
    const days = Math.round((endOfDay(end).getTime() - start.getTime()) / DAY_MS);
    return {
      from: start,
      to: end,
      days: Math.max(days, 1),
      label:
        formatDay(start) === formatDay(end)
          ? formatDay(start)
          : `${formatDay(start)} to ${formatDay(end)}`,
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

  const end = endOfDay(new Date());
  if (preset.endsYesterday) end.setUTCDate(end.getUTCDate() - 1);
  const start = startOfDay(new Date(end.getTime() - (preset.days - 1) * DAY_MS));

  return { from: start, to: end, days: preset.days, label: preset.label };
}
