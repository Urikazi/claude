import { isQuotedFor, lookupLineCost, type TierTable } from "@/lib/cost-tiers";

/**
 * Auditing a fulfilment invoice against the agreed price list.
 *
 * The supplier bills per parcel, not per unit: an order's units of one product are
 * charged once against the quantity break, and its remaining lines come through at zero.
 * That is the same shape the COGS engine already prices, so the check is a comparison
 * rather than a second model — a line billed at more than the quote says is either a
 * price rise nobody mentioned or a mistake, and both are worth seeing on the day.
 */

export type InvoiceLine = {
  orderRef: string;
  date: string;
  country: string;
  product: string;
  /** The variant as picked, e.g. FL2600896-L. */
  variantSku: string;
  /** What the supplier billed against, usually the family SKU. */
  billedSku: string;
  /** Units this line was charged for. Zero on the free half of a two-for-one. */
  billedQuantity: number;
  charged: number;
  tax: number;
  total: number;
};

/** A quoted CSV parser: address and bundle fields contain commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Strip a byte-order mark, which would otherwise become part of the first header.
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const number = (value: string | undefined): number => {
  const parsed = Number.parseFloat((value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Column positions, found by header.
 *
 * The sheet repeats `Country`, `SKU` and `Qty`, so each is taken by which occurrence it
 * is rather than by name: the second SKU is what the supplier billed against and the
 * second Qty is what it billed for, which are the two the audit turns on.
 */
function locateColumns(header: string[]) {
  const positions = (name: string) =>
    header.flatMap((cell, index) => (cell.trim() === name ? [index] : []));

  const countries = positions("Country");
  const skus = positions("SKU");
  const quantities = positions("Qty");

  return {
    orderRef: header.findIndex((cell) => cell.trim() === "Order number"),
    reference: header.findIndex((cell) => cell.trim() === "Order number-PY"),
    date: header.findIndex((cell) => cell.trim() === "Date"),
    country: countries[0] ?? -1,
    product: header.findIndex((cell) => cell.trim() === "Product"),
    variantSku: skus[0] ?? -1,
    billedSku: skus[1] ?? skus[0] ?? -1,
    billedQuantity: quantities[1] ?? quantities[0] ?? -1,
    price: header.findIndex((cell) => cell.trim() === "Price"),
    tax: header.findIndex((cell) => cell.trim() === "EU TAX"),
    total: header.findIndex((cell) => cell.trim() === "TOTAL Price"),
  };
}

export class InvoiceFormatError extends Error {}

export function parseInvoice(text: string): { lines: InvoiceLine[]; statedTotal: number | null } {
  const rows = parseCsv(text);
  if (!rows.length) throw new InvoiceFormatError("The file is empty.");

  const columns = locateColumns(rows[0]);
  const missing = (["date", "country", "billedSku", "billedQuantity", "price"] as const).filter(
    (key) => columns[key] < 0,
  );
  if (missing.length) {
    throw new InvoiceFormatError(
      `This does not look like a supplier order export — no ${missing.join(", ")} column. Export the daily order sheet from your supplier and upload that.`,
    );
  }

  const lines: InvoiceLine[] = [];
  let statedTotal: number | null = null;

  for (const row of rows.slice(1)) {
    const at = (index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");
    // The sheet ends with a totals row: no order, an amount under TOTAL Price.
    if (!at(columns.orderRef) && !at(columns.date)) {
      const value = number(at(columns.total));
      if (value > 0) statedTotal = value;
      continue;
    }

    const billedSku = at(columns.billedSku);
    if (!billedSku) continue;

    lines.push({
      orderRef: at(columns.reference) || at(columns.orderRef),
      date: at(columns.date).slice(0, 10),
      country: at(columns.country).toUpperCase(),
      product: at(columns.product),
      variantSku: at(columns.variantSku),
      billedSku,
      billedQuantity: Math.round(number(at(columns.billedQuantity))),
      charged: number(at(columns.price)),
      tax: number(at(columns.tax)),
      total: number(at(columns.total)),
    });
  }

  return { lines, statedTotal };
}

export type AuditVerdict =
  | "ok"
  | "overcharged"
  | "undercharged"
  /** The SKU has no price at all in the list. */
  | "unpriced"
  /** Priced, but not for this destination — there is nothing to check against. */
  | "no-country-quote";

export type AuditedLine = InvoiceLine & {
  /** What the agreed price list says this line should cost. Null when it has no price. */
  expected: number | null;
  /** Charged less expected. Positive means the supplier billed above the quote. */
  variance: number;
  verdict: AuditVerdict;
};

export type InvoiceAudit = {
  lines: AuditedLine[];
  /** Lines that were actually billed, i.e. the free half of an offer is not counted. */
  billedLines: number;
  totalCharged: number;
  totalExpected: number;
  /** Charged less expected across every line that could be priced. */
  variance: number;
  overcharged: AuditedLine[];
  undercharged: AuditedLine[];
  unpriced: AuditedLine[];
  /** Billed for a destination the quote does not cover, so nothing was checked. */
  noCountryQuote: AuditedLine[];
  /** The invoice's own total, and whether its lines add up to it. */
  statedTotal: number | null;
  lineSum: number;
};

/** A cent of slack, so a rounded quote does not read as a discrepancy. */
const TOLERANCE = 0.011;

export function auditInvoice(
  table: TierTable,
  parsed: { lines: InvoiceLine[]; statedTotal: number | null },
): InvoiceAudit {
  const lines: AuditedLine[] = parsed.lines.map((line) => {
    // A zero-quantity line is the free half of an offer, already paid for on its
    // sibling. Charging for it would be the overcharge, so zero is the expectation.
    if (line.billedQuantity <= 0) {
      return {
        ...line,
        expected: 0,
        variance: line.charged,
        verdict: line.charged > TOLERANCE ? "overcharged" : "ok",
      };
    }

    const expected = lookupLineCost(table, line.billedSku, line.country, line.billedQuantity);
    if (expected === null) {
      return { ...line, expected: null, variance: 0, verdict: "unpriced" };
    }

    // Without a quote for this destination the only comparison available is against
    // some other country's price, which would call every such line a discrepancy.
    if (!isQuotedFor(table, line.billedSku, line.country)) {
      return { ...line, expected: null, variance: 0, verdict: "no-country-quote" };
    }

    const variance = Math.round((line.charged - expected) * 100) / 100;
    return {
      ...line,
      expected,
      variance,
      verdict:
        variance > TOLERANCE ? "overcharged" : variance < -TOLERANCE ? "undercharged" : "ok",
    };
  });

  const priced = lines.filter((line) => line.expected !== null);
  const totalCharged = priced.reduce((sum, line) => sum + line.charged, 0);
  const totalExpected = priced.reduce((sum, line) => sum + (line.expected ?? 0), 0);

  return {
    lines,
    billedLines: lines.filter((line) => line.billedQuantity > 0).length,
    totalCharged: round2(totalCharged),
    totalExpected: round2(totalExpected),
    variance: round2(totalCharged - totalExpected),
    overcharged: lines.filter((line) => line.verdict === "overcharged"),
    undercharged: lines.filter((line) => line.verdict === "undercharged"),
    unpriced: lines.filter((line) => line.verdict === "unpriced"),
    noCountryQuote: lines.filter((line) => line.verdict === "no-country-quote"),
    statedTotal: parsed.statedTotal,
    // Includes tax, which the quote does not cover, so this is checked against the
    // invoice's own total rather than against the price list.
    lineSum: round2(lines.reduce((sum, line) => sum + line.total, 0)),
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
