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
