import dermaMuse from "../../data/derma-muse-price-list.json";
import veyla from "../../data/veyla-price-list.json";
import { priceListSchema, type PriceList } from "@/lib/price-list";

/**
 * The supplier quotes that ship with the dashboard.
 *
 * Copying a JSON file out of the repository and pasting it into a textarea is a lot of
 * ceremony for the one action that makes profit numbers real, and it is where setup
 * stalls. There is more than one store now, so the lists are keyed rather than
 * hardcoded, and each store is offered every list — matching a list to a store by name
 * would guess wrong the first time someone renames one.
 */
export type BundledPriceList = {
  key: string;
  label: string;
  /** How many prices the list carries, for the copy on the import button. */
  prices: number;
  countries: number;
  list: PriceList;
};

function describe(key: string, label: string, raw: unknown): BundledPriceList {
  // Parsed rather than cast: a hand-edited data file that no longer matches the schema
  // should fail here, at build and on first render, not halfway through an import.
  const list = priceListSchema.parse(raw);
  const countries = new Set<string>();
  let prices = 0;
  for (const product of list.products) {
    for (const [country, totals] of Object.entries(product.tiers)) {
      if (country !== "*") countries.add(country);
      prices += totals.length;
    }
  }
  return { key, label, prices, countries: countries.size, list };
}

export const BUNDLED_PRICE_LISTS: BundledPriceList[] = [
  describe("derma-muse", "Derma Muse", dermaMuse),
  describe("veyla", "Veyla", veyla),
];

export function findBundledPriceList(key: string): BundledPriceList | undefined {
  return BUNDLED_PRICE_LISTS.find((entry) => entry.key === key);
}

/**
 * The parts of a bundled list the import UI needs, without shipping the whole table of
 * prices to the browser to render one button.
 */
export type BundledPriceListOption = {
  key: string;
  label: string;
  prices: number;
  countries: number;
  products: { sku: string; name?: string }[];
};

export function bundledPriceListOptions(): BundledPriceListOption[] {
  return BUNDLED_PRICE_LISTS.map(({ key, label, prices, countries, list }) => ({
    key,
    label,
    prices,
    countries,
    products: list.products.map(({ sku, name }) => ({ sku, name })),
  }));
}
