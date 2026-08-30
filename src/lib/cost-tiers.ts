/**
 * Supplier price lists quote a total per (product, destination, quantity), and those
 * totals are not a unit price times quantity. Two Foundation Sticks to the US cost
 * 9.99, not 2 x 6.59, because the parcel ships once. Multiplying a unit cost
 * overstates COGS on every multi-unit order.
 *
 * So the cost of a line is looked up, not computed.
 */

export type Tier = { quantity: number; totalCost: number };

/** Tiers for one SKU, keyed by ISO country, with "*" meaning "anywhere". */
export type CountryTiers = Map<string, Tier[]>;

/** Every SKU's tiers, keyed by SKU. */
export type TierTable = Map<string, CountryTiers>;

export const ANY_COUNTRY = "*";

export function buildTierTable(
  rows: { sku: string; country: string; quantity: number; totalCost: number }[],
): TierTable {
  const table: TierTable = new Map();
  for (const row of rows) {
    const byCountry = table.get(row.sku) ?? new Map();
    const tiers = byCountry.get(row.country) ?? [];
    tiers.push({ quantity: row.quantity, totalCost: row.totalCost });
    byCountry.set(row.country, tiers);
    table.set(row.sku, byCountry);
  }
  for (const byCountry of table.values()) {
    for (const tiers of byCountry.values()) tiers.sort((a, b) => a.quantity - b.quantity);
  }
  return table;
}

/**
 * A country-specific price beats the catch-all: the add-ons are quoted once for
 * everywhere, while the main product is quoted per destination.
 */
function tiersFor(table: TierTable, sku: string, country: string | null): Tier[] | null {
  const byCountry = table.get(sku);
  if (!byCountry) return null;
  return (
    (country ? byCountry.get(country.toUpperCase()) : undefined) ??
    byCountry.get(ANY_COUNTRY) ??
    null
  );
}

/**
 * Quantities beyond the quoted table are extrapolated from the marginal cost of the
 * last two tiers — the per-unit slope once shipping is already paid — rather than
 * from the first tier, which still carries the whole parcel charge.
 *
 * A single-tier list (the flat-priced add-ons) has no slope, so it scales linearly.
 */
export function lookupLineCost(
  table: TierTable,
  sku: string | null,
  country: string | null,
  quantity: number,
): number | null {
  if (!sku || quantity <= 0) return null;
  const tiers = tiersFor(table, sku, country);
  if (!tiers?.length) return null;

  const exact = tiers.find((t) => t.quantity === quantity);
  if (exact) return exact.totalCost;

  const last = tiers[tiers.length - 1];
  if (quantity < last.quantity) {
    // A gap in the middle of the table: interpolate between the neighbouring tiers.
    const below = [...tiers].reverse().find((t) => t.quantity < quantity);
    const above = tiers.find((t) => t.quantity > quantity);
    if (below && above) {
      const slope = (above.totalCost - below.totalCost) / (above.quantity - below.quantity);
      return below.totalCost + slope * (quantity - below.quantity);
    }
    if (above) return (above.totalCost / above.quantity) * quantity;
  }

  const previous = tiers[tiers.length - 2];
  const marginal = previous
    ? (last.totalCost - previous.totalCost) / (last.quantity - previous.quantity)
    : last.totalCost / last.quantity;
  return last.totalCost + marginal * (quantity - last.quantity);
}
