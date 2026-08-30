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
export function resolveRange(range?: string): { from: Date; to: Date; days: number; label: string } {
  const presets: Record<string, { days: number; label: string }> = {
    today: { days: 1, label: "Today" },
    "7d": { days: 7, label: "Last 7 days" },
    "30d": { days: 30, label: "Last 30 days" },
    "90d": { days: 90, label: "Last 90 days" },
  };
  const preset = presets[range ?? "30d"] ?? presets["30d"];

  const now = new Date();
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  );
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (preset.days - 1));
  from.setUTCHours(0, 0, 0, 0);

  return { from, to, days: preset.days, label: preset.label };
}
