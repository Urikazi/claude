/**
 * Parses rows pasted straight out of Ads Manager (or a spreadsheet) into daily ad
 * spend. Typing a month of spend by hand is the kind of chore people quietly stop
 * doing, which leaves the profit number wrong, so the bar here is "select the table,
 * copy, paste" — no cleanup first.
 *
 * Accepts tab, comma or semicolon separated rows, with or without a header, and
 * tolerates the shapes Ads Manager exports:
 *
 *   2026-08-01     124.53
 *   Aug 1, 2026    $1,124.53      Some campaign
 *   01/08/2026;124,53
 */

export type ParsedSpendRow = { date: string; spend: number; campaignName?: string };

export type PasteResult = {
  rows: ParsedSpendRow[];
  /** 1-based line numbers that could not be read, for reporting back. */
  skipped: number[];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects the likes of 31 February, which Date would roll into March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function parseDate(raw: string): string | null {
  const value = raw.trim().replace(/^["']|["']$/g, "");
  if (!value) return null;

  const ymd = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) return iso(+ymd[1], +ymd[2], +ymd[3]);

  // "Aug 1, 2026" / "1 Aug 2026" / "August 1 2026"
  const named = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    return month ? iso(+named[3], month, +named[2]) : null;
  }
  const namedLast = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/);
  if (namedLast) {
    const month = MONTHS[namedLast[2].slice(0, 3).toLowerCase()];
    return month ? iso(+namedLast[3], month, +namedLast[1]) : null;
  }

  /**
   * Ambiguous numeric dates. Ads Manager exports in the account's locale, so
   * 01/08/2026 is the 1st of August in most of the world and the 8th of January in
   * the US. Day-first is assumed unless the first number cannot be a day, because
   * guessing wrong silently misdates a whole month of spend.
   */
  const slashed = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (slashed) {
    const [a, b, year] = [+slashed[1], +slashed[2], +slashed[3]];
    if (a > 12 && b <= 12) return iso(year, b, a);
    if (b > 12 && a <= 12) return iso(year, a, b);
    return iso(year, b, a);
  }

  return null;
}

export function parseAmount(raw: string): number | null {
  let value = raw.trim().replace(/^["']|["']$/g, "");
  if (!value) return null;

  // Strip currency symbols, codes and spaces, keeping digits and separators.
  value = value.replace(/[^\d.,-]/g, "");
  if (!value || !/\d/.test(value)) return null;

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal separator; the other groups thousands.
    value =
      lastComma > lastDot
        ? value.replace(/\./g, "").replace(",", ".")
        : value.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,234" is thousands; "12,34" is a decimal comma.
    const decimals = value.length - lastComma - 1;
    value = decimals === 3 ? value.replace(/,/g, "") : value.replace(",", ".");
  }

  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/**
 * One delimiter per line, most specific first. Splitting on every candidate at once
 * would tear "$1,240.10" in half at its thousands separator — and a copy out of Ads
 * Manager is tab-separated, so the comma is part of the number, not a column break.
 */
function splitCells(line: string): string[] {
  const delimiter = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  return line.split(delimiter).map((c) => c.trim());
}

export function parseSpendPaste(text: string): PasteResult {
  const rows: ParsedSpendRow[] = [];
  const skipped: number[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const cells = splitCells(line);

    const date = cells.map(parseDate).find((d) => d !== null) ?? null;
    if (!date) {
      // A header row is expected, not an error worth reporting.
      if (!/date|amount|spent|spend|campaign|reporting/i.test(line)) skipped.push(index + 1);
      return;
    }

    const dateCell = cells.findIndex((c) => parseDate(c) !== null);
    const amount = cells
      .filter((_, i) => i !== dateCell)
      .map(parseAmount)
      .find((a) => a !== null);
    if (amount === undefined || amount === null) {
      skipped.push(index + 1);
      return;
    }

    const campaignName = cells.find(
      (c, i) => i !== dateCell && c.length > 0 && parseAmount(c) === null && parseDate(c) === null,
    );

    rows.push({ date, spend: amount, ...(campaignName ? { campaignName } : {}) });
  });

  return { rows, skipped };
}
