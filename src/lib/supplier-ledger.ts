import { parseCsv } from "@/lib/invoice-audit";

/**
 * The supplier's running payment ledger.
 *
 * One sheet per year, one row per event: a day's bill for a store ("Derma Muse,
 * #95674-#96269, $6,010.92"), a payment sent to the supplier, a credit for cancelled
 * orders, a sample shipped. The bills are the point — each one is the real, all-in
 * cost of a known range of orders, which is what turns the price-list estimate into an
 * actual figure.
 *
 * The sheet is maintained by hand, so the parser expects drift: an order range without
 * its "#", a dash missing between two numbers, a stray summary block below the data.
 * It accepts the first two, and skips anything that does not carry a money figure.
 */

export type LedgerKind = "bill" | "credit" | "charge" | "payment";

export type LedgerLine = {
  /// YYYY-MM-DD.
  date: string;
  kind: LedgerKind;
  label: string;
  reference: string | null;
  /// The store name exactly as the ledger wrote it, where the line is a store's.
  storeLabel: string | null;
  firstOrder: number | null;
  lastOrder: number | null;
  /// Positive for a cost, negative for a credit; the cash sent on a payment.
  amount: number;
};

export class LedgerFormatError extends Error {}

/// The digits of an order name: "#95674" is 95674. Null where there are none.
export function orderNumberFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const digits = name.replace(/\D/g, "");
  if (!digits || digits.length > 9) return null;
  return Number.parseInt(digits, 10);
}

/// Lowercase letters and digits only, so "Derma Muse" and "DermaMuse" are one store.
export function normalizeStoreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/store$/, "");
}

/// "$3,655.51", "-$681.40", "$-681.40". Null for anything that is not money.
function parseMoney(cell: string | undefined): number | null {
  const text = (cell ?? "").trim().replace(/\s/g, "");
  if (!/^-?\$?-?[\d,]*\.?\d+$/.test(text)) return null;
  const negative = text.includes("-");
  const value = Number.parseFloat(text.replace(/[-$,]/g, ""));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * The order range on a bill.
 *
 * Written by hand as "#41930-#42273", "43633-#43939", or "#9290#9389" with the dash
 * lost. Any two runs of digits are a range and one is a single order. A range running
 * backwards, or spanning more orders than any day has ever produced, is a typo rather
 * than a bill, and is refused so it cannot spread one day's cost over a month.
 */
export function parseOrderRange(cell: string): { first: number; last: number } | null {
  const runs = cell.replace(/\\/g, "").match(/\d+/g);
  if (!runs || runs.length > 2) return null;
  const first = Number.parseInt(runs[0], 10);
  const last = Number.parseInt(runs[runs.length - 1], 10);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  if (last < first || last - first > 5000) return null;
  return { first, last };
}

const PAYMENT_LABEL = /bank\s*transfer|paypal|wire|payoneer|wise/i;

/**
 * Read the ledger out of a CSV export of its sheet.
 *
 * The year is not on the rows — dates read "11-9" — so it is taken from the sheet's
 * own title cell ("2026") where the export kept it, and from the caller otherwise.
 * `knownStores` decides which rows are bills: a row whose store column names one of
 * them, with an order range, is a bill for that store; anything else is a line the
 * ledger does not tie to a store of ours, kept so its total can still be shown.
 */
export function parseSupplierLedger(
  text: string,
  knownStores: string[],
  fallbackYear: number,
): { year: number; lines: LedgerLine[]; skipped: number } {
  const rows = parseCsv(text);
  const lower = (cell: string | undefined) => (cell ?? "").trim().toLowerCase();

  const headerIndex = rows.findIndex(
    (row) =>
      row.some((cell) => lower(cell) === "store") &&
      row.some((cell) => lower(cell) === "amount"),
  );
  if (headerIndex === -1) {
    throw new LedgerFormatError(
      "No header row with Store and Amount columns. Upload the ledger's yearly tab (the one starting \"Date, Bill details, Store, Order number, Prepayment, Amount\"), downloaded as CSV.",
    );
  }
  const header = rows[headerIndex].map(lower);
  const column = (name: string) => header.findIndex((cell) => cell === name || cell.endsWith(` ${name}`));
  const dateCol = column("date");
  const storeCol = column("store");
  const orderCol = header.findIndex((cell) => cell.startsWith("order"));
  const prepaidCol = column("prepayment");
  const amountCol = column("amount");
  if (dateCol === -1 || storeCol === -1 || amountCol === -1) {
    throw new LedgerFormatError("The header row is missing a Date, Store or Amount column.");
  }

  // The sheet's title cell, e.g. "2026" alone above the header or "2026 Date" in it.
  let year = fallbackYear;
  for (const row of rows.slice(0, headerIndex + 1)) {
    const found = row.join(" ").match(/\b(20\d{2})\b/);
    if (found) {
      year = Number.parseInt(found[1], 10);
      break;
    }
  }

  const known = new Map(knownStores.map((name) => [normalizeStoreName(name), name]));
  const lines: LedgerLine[] = [];
  let skipped = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    const dateCell = (row[dateCol] ?? "").trim();
    const dated = dateCell.match(/^(\d{1,2})[-./](\d{1,2})$/);
    const label = (row[storeCol] ?? "").replace(/\\/g, "").replace(/\s+/g, " ").trim();
    const amount = parseMoney(row[amountCol]);
    const prepaid = prepaidCol === -1 ? null : parseMoney(row[prepaidCol]);

    // A row with no date, or no money in it, is a blank, a heading or the summary
    // block the sheet keeps below its data — never a ledger line.
    if (!dated || !label || /^\d+$/.test(label) || (amount === null && prepaid === null)) {
      if (dated && label) skipped += 1;
      continue;
    }
    const month = Number.parseInt(dated[1], 10);
    const day = Number.parseInt(dated[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      skipped += 1;
      continue;
    }
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const reference = (orderCol === -1 ? "" : (row[orderCol] ?? "")).replace(/\\/g, "").trim() || null;

    // Cash to the supplier sits in the prepayment column. It settles the bills; it is
    // not a cost, and counting it as one would charge every order twice.
    if (prepaid && !amount) {
      lines.push({
        date,
        kind: "payment",
        label,
        reference,
        storeLabel: null,
        firstOrder: null,
        lastOrder: null,
        amount: prepaid,
      });
      continue;
    }
    if (amount === null || amount === 0) {
      skipped += 1;
      continue;
    }

    const store = known.get(normalizeStoreName(label)) ?? null;
    const range = store && reference ? parseOrderRange(reference) : null;
    if (store && range && amount > 0) {
      lines.push({
        date,
        kind: "bill",
        label,
        reference,
        storeLabel: store,
        firstOrder: range.first,
        lastOrder: range.last,
        amount,
      });
      continue;
    }

    lines.push({
      date,
      kind: PAYMENT_LABEL.test(label) && amount > 0 ? "payment" : amount < 0 ? "credit" : "charge",
      label,
      reference,
      // A store's own line with no order range ("Derma Muse, Multiple QTY-refund") is
      // still that store's, and lands on its P&L on the ledger's date.
      storeLabel: store,
      firstOrder: null,
      lastOrder: null,
      amount,
    });
  }

  if (!lines.length) {
    throw new LedgerFormatError("Found the header, but no dated line with an amount beneath it.");
  }
  return { year, lines, skipped };
}

/**
 * Bills whose order ranges overlap.
 *
 * Ranges are typed by hand, and an overlap means some orders are on two bills — billed
 * twice. The import charges them twice, because that is what the ledger says was
 * billed; this names the pair so it can be raised with the supplier.
 */
export function findOverlaps(lines: LedgerLine[]): string[] {
  const bills = lines
    .filter((line) => line.kind === "bill")
    .sort((a, b) => (a.storeLabel ?? "").localeCompare(b.storeLabel ?? "") || a.firstOrder! - b.firstOrder!);
  const found: string[] = [];
  for (let i = 1; i < bills.length; i += 1) {
    const previous = bills[i - 1];
    const current = bills[i];
    if (previous.storeLabel === current.storeLabel && current.firstOrder! <= previous.lastOrder!) {
      found.push(
        `${current.storeLabel}: ${previous.date} (#${previous.firstOrder}–#${previous.lastOrder}) and ${current.date} (#${current.firstOrder}–#${current.lastOrder})`,
      );
    }
  }
  return found;
}
