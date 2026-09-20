import { z } from "zod";

/**
 * Import format for a supplier price list.
 *
 * `tiers` maps an ISO country code (or "*" for everywhere) to the quoted totals in
 * quantity order: the first entry is the price for one unit, the second for two, and
 * so on. Totals, not unit prices — that is the whole point of the format, since a
 * fulfilment quote bundles one parcel charge into the first unit.
 */
export const priceListSchema = z.object({
  source: z.string().optional(),
  currency: z.string().optional(),
  currencyNote: z.string().optional(),
  note: z.string().optional(),
  /**
   * What the quoted totals actually cover.
   *
   * `landed` is the default because it is what a price list is normally for: the
   * supplier's figure is the whole cost of getting the parcel to the buyer. Some
   * suppliers quote the freight alone and leave the product itself to a separate
   * sheet, and a list like that imported as-is would price every unit at zero and
   * report the product's entire margin as profit. Saying so here lets the import
   * ask for the missing unit cost instead of quietly overstating the business.
   */
  basis: z.enum(["landed", "shipping-only"]).optional(),
  products: z
    .array(
      z.object({
        sku: z.string().min(1),
        name: z.string().optional(),
        tiers: z.record(z.string(), z.array(z.number().nonnegative()).min(1)),
      }),
    )
    .min(1),
});

export type PriceList = z.infer<typeof priceListSchema>;

/**
 * Folds a product cost per unit into a shipping-only quote, turning freight totals
 * into landed COGS.
 *
 * The unit cost scales with quantity while the parcel charge does not, which is why
 * it is added per tier rather than to the first one: three units to the US cost the
 * quoted freight for three plus three times the product.
 *
 * Returns the SKUs still missing a cost rather than defaulting them to zero — a
 * silent zero is the failure this whole field exists to prevent.
 */
export function withUnitCosts(
  list: PriceList,
  unitCosts: Record<string, number>,
): { list: PriceList; missing: string[] } {
  const missing: string[] = [];
  const products = list.products.map((product) => {
    const unit = unitCosts[product.sku];
    if (!(typeof unit === "number" && Number.isFinite(unit) && unit > 0)) {
      missing.push(product.sku);
      return product;
    }
    const tiers = Object.fromEntries(
      Object.entries(product.tiers).map(([country, totals]) => [
        country,
        totals.map((total, index) =>
          // Cents, so the stored figure is a real money amount and not 14.019999999998.
          Math.round((total + unit * (index + 1)) * 100) / 100,
        ),
      ]),
    );
    return { ...product, tiers };
  });
  return { list: { ...list, basis: "landed", products }, missing };
}

export type TierRow = { sku: string; country: string; quantity: number; totalCost: number };

export function priceListToRows(list: PriceList): TierRow[] {
  const rows: TierRow[] = [];
  for (const product of list.products) {
    for (const [country, totals] of Object.entries(product.tiers)) {
      totals.forEach((totalCost, index) => {
        rows.push({
          sku: product.sku,
          country: country.toUpperCase(),
          quantity: index + 1,
          totalCost,
        });
      });
    }
  }
  return rows;
}

export function parsePriceList(
  raw: string,
): { ok: true; list: PriceList } | { ok: false; message: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, message: "That is not valid JSON. Paste the whole file, including the outer { }." };
  }
  const parsed = priceListSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message: `Price list is not in the expected shape: ${issue.path.join(".") || "root"} — ${issue.message}.`,
    };
  }
  return { ok: true, list: parsed.data };
}
