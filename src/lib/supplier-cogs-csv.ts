import { parseCsv } from "@/lib/invoice-audit";
import type { PriceList } from "@/lib/price-list";

/**
 * Reading the supplier's own COGS sheet.
 *
 * The quotes arrive as a wide grid — one row per destination, one column per quantity —
 * which is not the shape the price list stores, so this turns one into the other. Doing
 * it here rather than by hand matters because the sheets change shape between quotes:
 * across a few months they have arrived with English and Chinese headers, with and
 * without a dollar sign, with "NO SHIPPING" spelled three ways, and with the add-on
 * rows missing the country columns the product rows carry.
 *
 * Nothing is inferred. A destination the sheet does not price is left out, so the order
 * reads as unquoted rather than being costed from a neighbouring country.
 */

/** The supplier bills Australia by zone; the invoices and the stored list use these. */
const COUNTRY_ALIASES: Record<string, string> = {
  "AU-1": "AU",
  "AU-2": "AU",
  "AU-3": "AU-REMOTE",
};

export type CogsCsvProduct = {
  sku: string;
  name?: string;
  /** Quantity -> quoted total. Sparse: the sheet does not price every quantity. */
  tiers: Record<string, Record<number, number>>;
};

export type CogsCsvReport = {
  list: PriceList;
  /** Destinations the sheet marks as not shippable, which carry no price. */
  noShipping: string[];
  /** Rows present but priced nowhere. */
  unpriced: string[];
  /** SKUs stored under a shorter family key than the sheet spelled. */
  renamed: { from: string; to: string }[];
  /** Quoted totals that fall as quantity rises — a sheet error worth querying. */
  anomalies: { sku: string; country: string; from: number; to: number; was: number; now: number }[];
  /** Destinations quoted at some quantities but not all, where a gap sits inside. */
  gapped: { sku: string; country: string; missing: number[] }[];
  counts: { products: number; destinations: number; prices: number };
};

export class CogsCsvError extends Error {}

const NUMBER = /^\$?-?[\d,]+(\.\d+)?$/;
const COUNTRY_LIKE = /^[A-Za-z]{2,}(-\d+)?$/;

const toNumber = (value: string): number =>
  Number.parseFloat(value.replace(/[$,\s]/g, ""));

/**
 * Where a row's figures begin.
 *
 * Product rows name a destination and repeat it in Chinese before the numbers start;
 * the add-on rows, quoted once for everywhere, carry neither. Rather than assume a
 * fixed offset, the destination is taken when it looks like one and the numbers are
 * then found by looking for the first one — which survives a sheet that drops the
 * Chinese column, or adds another descriptive one.
 */
function locateRow(cells: string[], skuIndex: number): { country: string; start: number | null } {
  const next = (cells[skuIndex + 1] ?? "").trim();
  const hasCountry = COUNTRY_LIKE.test(next) && !NUMBER.test(next);
  const country = hasCountry ? next : "*";
  for (let i = skuIndex + (hasCountry ? 2 : 1); i < cells.length; i += 1) {
    const cell = (cells[i] ?? "").trim();
    if (NUMBER.test(cell) || cell === "/") return { country, start: i };
  }
  // A row with no figures at all is still a destination worth naming — it is how the
  // sheet writes one it will not ship to.
  return { country, start: null };
}

/**
 * A variant suffix the Shopify SKU may not carry.
 *
 * Family matching only ever shortens, so a sheet's `AL2500767-17` is found from the
 * stored `AL2500767` but not the reverse. Storing the shorter key is reachable from
 * either spelling. Only a numeric suffix is stripped: the shade suffixes on the
 * foundation stick (-M, -L) distinguish real variants that could be priced apart.
 */
function familySku(sku: string): string {
  return sku.replace(/-\d+$/, "");
}

export function parseCogsCsv(text: string): CogsCsvReport {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  if (!rows.length) throw new CogsCsvError("That file is empty.");

  // Quantities come from the header's bare integer columns, and each row's figures are
  // matched to them by position from wherever that row's numbers start.
  const header = rows[0].map((cell) => cell.trim());
  const quantities = header.flatMap((cell) => (/^\d+$/.test(cell) ? [Number(cell)] : []));
  if (quantities.length < 2) {
    throw new CogsCsvError(
      "No quantity columns found. The header needs a column per quantity, numbered 0, 1, 2 and so on — export the supplier's COGS sheet as CSV without reformatting it.",
    );
  }
  const skuIndex = header.findIndex((cell) => cell.toUpperCase() === "SKU");
  if (skuIndex < 0) {
    throw new CogsCsvError("No SKU column found in the header row.");
  }

  const products = new Map<string, CogsCsvProduct>();
  const report: Omit<CogsCsvReport, "list" | "counts"> = {
    noShipping: [],
    unpriced: [],
    renamed: [],
    anomalies: [],
    gapped: [],
  };
  const renamed = new Set<string>();

  for (const cells of rows.slice(1)) {
    const rawSku = (cells[skuIndex] ?? "").trim();
    if (!rawSku || !/^[A-Z]{2}\d/i.test(rawSku)) continue;

    const sku = familySku(rawSku);
    if (sku !== rawSku && !renamed.has(rawSku)) {
      renamed.add(rawSku);
      report.renamed.push({ from: rawSku, to: sku });
    }

    const located = locateRow(cells, skuIndex);
    const country = (COUNTRY_ALIASES[located.country.toUpperCase()] ?? located.country).toUpperCase();
    const label = country === "*" ? sku : `${sku} ${country}`;
    if (/no\s*shipping/i.test(cells.join(" "))) {
      report.noShipping.push(country);
      continue;
    }
    if (located.start === null) {
      report.unpriced.push(label);
      continue;
    }
    const { start } = located;
    const tiers: Record<number, number> = {};
    quantities.forEach((quantity, offset) => {
      if (quantity <= 0) return;
      const cell = (cells[start + offset] ?? "").trim();
      if (!cell || cell === "/" || !NUMBER.test(cell)) return;
      const total = toNumber(cell);
      if (Number.isFinite(total) && total > 0) tiers[quantity] = Math.round(total * 100) / 100;
    });

    if (!Object.keys(tiers).length) {
      report.unpriced.push(label);
      continue;
    }

    const product = products.get(sku) ?? {
      sku,
      name: (cells[1] ?? "").trim() || undefined,
      tiers: {},
    };
    product.tiers[country] = tiers;
    products.set(sku, product);

    const quoted = Object.keys(tiers).map(Number).sort((a, b) => a - b);
    const missing = Array.from({ length: quoted[quoted.length - 1] }, (_, i) => i + 1).filter(
      (q) => q > quoted[0] && !(q in tiers),
    );
    if (missing.length) report.gapped.push({ sku, country, missing });
    for (const [a, b] of quoted.slice(1).map((q, i) => [quoted[i], q] as const)) {
      if (tiers[b] < tiers[a]) {
        report.anomalies.push({ sku, country, from: a, to: b, was: tiers[a], now: tiers[b] });
      }
    }
  }

  if (!products.size) {
    throw new CogsCsvError(
      "No priced rows found. Each row needs a SKU and at least one quantity priced — check the SKU column is filled in.",
    );
  }

  const list: PriceList = {
    products: [...products.values()].map((product) => ({
      sku: product.sku,
      name: product.name,
      tiers: Object.fromEntries(
        Object.entries(product.tiers).map(([country, tiers]) => {
          const quoted = Object.keys(tiers).map(Number).sort((a, b) => a - b);
          // A dense run from one unit keeps the compact list form; only a quote with a
          // hole in it needs the quantity-keyed one.
          const dense = quoted.every((q, i) => q === i + 1);
          return [
            country,
            dense
              ? quoted.map((q) => tiers[q])
              : Object.fromEntries(quoted.map((q) => [String(q), tiers[q]])),
          ];
        }),
      ),
    })),
  };

  const destinations = new Set(
    list.products.flatMap((p) => Object.keys(p.tiers).map((c) => `${p.sku}:${c}`)),
  );
  const prices = list.products.reduce(
    (sum, p) =>
      sum +
      Object.values(p.tiers).reduce(
        (n, t) => n + (Array.isArray(t) ? t.length : Object.keys(t).length),
        0,
      ),
    0,
  );

  return {
    ...report,
    list,
    counts: { products: list.products.length, destinations: destinations.size, prices },
  };
}
