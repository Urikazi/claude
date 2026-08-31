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
 * Shopify SKUs carry a variant suffix the supplier's does not: a price list quoting
 * FL2600896 has to cover FL2600896-M, -L and -D, because the shade does not change
 * what the supplier charges. Longest first, so an exact entry always wins over the
 * family price.
 */
export function skuCandidates(sku: string): string[] {
  const parts = sku.split("-");
  const candidates = [sku];
  while (parts.length > 1) {
    parts.pop();
    candidates.push(parts.join("-"));
  }
  return candidates;
}

/**
 * A country-specific price beats the catch-all: the add-ons are quoted once for
 * everywhere, while the main product is quoted per destination.
 */
function tiersFor(table: TierTable, sku: string, country: string | null): Tier[] | null {
  for (const candidate of skuCandidates(sku)) {
    const byCountry = table.get(candidate);
    if (!byCountry) continue;
    const tiers =
      (country ? byCountry.get(country.toUpperCase()) : undefined) ??
      byCountry.get(ANY_COUNTRY);
    if (tiers?.length) return tiers;
  }
  return null;
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

/** Which priced SKU a variant resolves to, if any. Mirrors the lookup's matching. */
export function resolveTierSku(pricedSkus: Set<string>, sku: string | null): string | null {
  if (!sku) return null;
  return skuCandidates(sku).find((candidate) => pricedSkus.has(candidate)) ?? null;
}

/**
 * Which priced SKU a variant belongs to within a tier table — the key a whole order
 * is grouped and costed under. Distinct from `resolveTierSku`, which answers the
 * same question from a plain set of SKUs for display purposes.
 */
export function tierGroupKey(table: TierTable, sku: string | null): string | null {
  if (!sku) return null;
  return skuCandidates(sku).find((candidate) => table.has(candidate)) ?? null;
}

export type CostedLine = { sku: string | null; quantity: number };

/**
 * Costs a whole order rather than each line separately.
 *
 * A fulfilment quote prices a parcel: two sticks to the US cost 9.99 however they
 * arrived in the basket. A buy-one-get-one adds a second line rather than raising
 * the quantity, and pricing the lines apart would charge 6.59 twice — 3.19 too much
 * on the store's most common order.
 *
 * Lines of the same product are grouped, priced once at their combined quantity,
 * and the total split back over them by quantity so per-product reporting still
 * adds up. Lines with no tier get null and fall back to per-unit costs.
 */
export function costOrderLines(
  table: TierTable,
  country: string | null,
  lines: CostedLine[],
): (number | null)[] {
  const groups = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const key = tierGroupKey(table, line.sku);
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  const costs: (number | null)[] = lines.map(() => null);
  for (const [key, indexes] of groups) {
    const totalQuantity = indexes.reduce((sum, i) => sum + lines[i].quantity, 0);
    const total = lookupLineCost(table, key, country, totalQuantity);
    if (total === null || totalQuantity <= 0) continue;

    /**
     * Rounded to whole cents here rather than by the caller, with the remainder put
     * on the largest line. Splitting 9.99 evenly gives 4.995 twice, which rounds to
     * 10.00 and quietly overstates the order — a cent that repeats across every
     * buy-one-get-one.
     */
    const rounded = Math.round(total * 100);
    let allocated = 0;
    indexes.forEach((i, position) => {
      const share =
        position === indexes.length - 1
          ? rounded - allocated
          : Math.round((rounded * lines[i].quantity) / totalQuantity);
      allocated += share;
      costs[i] = share / 100;
    });
  }
  return costs;
}

/**
 * Whether a variant can be costed at all.
 *
 * Costs live in the tier table, so a variant is covered when its own SKU is priced,
 * when a shorter family SKU is, or when the legacy per-unit field is still filled in.
 * Testing `ProductVariant.cogs` alone reports every tier-costed variant as missing.
 */
export function isVariantCosted(
  pricedSkus: Set<string>,
  variant: { sku: string | null; cogs: number },
): boolean {
  return variant.cogs > 0 || resolveTierSku(pricedSkus, variant.sku) !== null;
}
