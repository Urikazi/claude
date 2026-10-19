import { z } from "zod";

/**
 * Import format for a supplier price list.
 *
 * `tiers` maps an ISO country code (or "*" for everywhere) to the quoted totals.
 * Totals, not unit prices — that is the whole point of the format, since a fulfilment
 * quote bundles one parcel charge into the first unit.
 *
 * A list in quantity order is the common case: the first entry prices one unit, the
 * second two, and so on. Quotes are not always that tidy, though — one arrived
 * pricing 1, 2, 3 and 5 units to the Netherlands but not 4 — so a quantity-keyed
 * object is accepted too. Dropping the 5 to keep a dense list would leave that order
 * extrapolated from the 3, which is the exact mistake this format exists to avoid.
 */
export const priceListSchema = z.object({
  source: z.string().optional(),
  currency: z.string().optional(),
  /** Free-text provenance, carried so a reader of the data file can check the figures. */
  currencyNote: z.string().optional(),
  note: z.string().optional(),
  products: z
    .array(
      z.object({
        sku: z.string().min(1),
        name: z.string().optional(),
        tiers: z.record(
          z.string(),
          z.union([
            z.array(z.number().nonnegative()).min(1),
            // Keys are quantities. Coerced rather than matched loosely, so "4.5" or
            // "qty4" is rejected at import instead of becoming a tier nobody meant.
            z
              .record(z.string().regex(/^[1-9]\d*$/), z.number().nonnegative())
              .refine((entry) => Object.keys(entry).length > 0, "needs at least one quantity"),
          ]),
        ),
      }),
    )
    .min(1),
});

export type PriceList = z.infer<typeof priceListSchema>;


export type TierRow = { sku: string; country: string; quantity: number; totalCost: number };

export function priceListToRows(list: PriceList): TierRow[] {
  const rows: TierRow[] = [];
  for (const product of list.products) {
    for (const [country, totals] of Object.entries(product.tiers)) {
      const quoted = Array.isArray(totals)
        ? totals.map((totalCost, index) => [index + 1, totalCost] as const)
        : Object.entries(totals).map(([quantity, totalCost]) => [Number(quantity), totalCost] as const);
      for (const [quantity, totalCost] of quoted) {
        rows.push({ sku: product.sku, country: country.toUpperCase(), quantity, totalCost });
      }
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
