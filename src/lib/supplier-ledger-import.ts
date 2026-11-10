import "server-only";
import { prisma } from "@/lib/db";
import {
  findOverlaps,
  LedgerFormatError,
  normalizeStoreName,
  parseSupplierLedger,
  type LedgerLine,
} from "@/lib/supplier-ledger";

export type LedgerImportResult = {
  year: number;
  /// The latest date on any of this store's lines: how current the ledger is.
  throughDate: string | null;
  bills: number;
  billed: number;
  ordersCosted: number;
  /// Bills none of whose orders are in the dashboard — before the sync window.
  unmatchedBills: number;
  unmatchedAmount: number;
  /// The store's own lines without an order range, put on the ledger's date instead.
  adjustments: number;
  adjustmentAmount: number;
  /// Lines tied to no store: samples, packaging, cancellation credits.
  unassigned: number;
  unassignedAmount: number;
  overlaps: string[];
};

const dayStart = (date: string) => new Date(`${date}T00:00:00.000Z`);

/**
 * Import the supplier's ledger for one store.
 *
 * The ledger is cumulative and the supplier corrects old rows, so this replaces the
 * store's lines for the sheet's year rather than appending, and re-spreads every bill
 * over its orders. That makes a daily re-upload of the same, slightly longer sheet the
 * whole workflow: nothing is double counted, and an edited row is picked up.
 *
 * Each bill's amount is spread over the orders in its range by their price-list cost,
 * so a four-unit parcel to Australia carries more of it than a single stick to Texas,
 * and the total lands exactly on what was billed. Orders with no price-list cost fall
 * back to units, then to an equal split. Overlapping ranges are summed rather than
 * picked between: an order on two lines was charged by both, which is usually an
 * add-on fee spread over a span of orders.
 */
export async function importSupplierLedger(
  storeId: string,
  text: string,
): Promise<LedgerImportResult> {
  const stores = await prisma.store.findMany({ select: { id: true, name: true } });
  const store = stores.find((candidate) => candidate.id === storeId);
  if (!store) throw new Error("Unknown store.");

  const { year, lines } = parseSupplierLedger(
    text,
    stores.map((candidate) => candidate.name),
    new Date().getUTCFullYear(),
  );

  // Another of our stores' lines are that store's to import, from its own page.
  const others = new Set(
    stores.filter((candidate) => candidate.id !== storeId).map((s) => normalizeStoreName(s.name)),
  );
  const mine = lines.filter((line) => line.storeLabel === store.name);
  const unassigned = lines.filter(
    (line) => !line.storeLabel && line.kind !== "payment" && !others.has(normalizeStoreName(line.label)),
  );
  const bills = mine.filter((line) => line.kind === "bill");
  const adjustments = mine.filter((line) => line.kind !== "bill" && line.kind !== "payment");
  // Checked before anything is written: the import replaces the store's year, so a
  // sheet with none of its bills — the wrong tab, another brand's — would otherwise
  // erase the ledger it was meant to update.
  if (!bills.length) {
    throw new LedgerFormatError(
      `No bills for ${store.name} in that sheet. The Store column has to read the same as this store's name, and the file has to be the ledger's yearly tab.`,
    );
  }

  const billJson = JSON.stringify(
    bills.map((bill, index) => ({
      idx: index,
      first: bill.firstOrder,
      last: bill.lastOrder,
      amount: bill.amount,
    })),
  );
  const min = Math.min(...bills.map((bill) => bill.firstOrder!));
  const max = Math.max(...bills.map((bill) => bill.lastOrder!));

  const yearFrom = new Date(Date.UTC(year, 0, 1));
  const yearTo = new Date(Date.UTC(year + 1, 0, 1));

  return prisma.$transaction(
    async (tx) => {
      const matched = await tx.$queryRaw<{ idx: number; n: number }[]>`
        SELECT b.idx, COUNT(o.id)::int AS n
        FROM jsonb_to_recordset(${billJson}::jsonb) AS b(idx int, "first" int, "last" int, amount float8)
        LEFT JOIN "Order" o
          ON o."storeId" = ${storeId}
         AND o."orderNumber" BETWEEN b."first" AND b."last"
        GROUP BY b.idx`;
      const matchedByIndex = new Map(matched.map((row) => [row.idx, row.n]));

      // The span the year's bills covered before this import. A corrected bill can
      // shrink, and the orders that fall off its end must lose the old charge too, so
      // the reset runs over the old span as well as the new one.
      const previous = await tx.supplierLedgerEntry.aggregate({
        where: { storeId, kind: "bill", date: { gte: yearFrom, lt: yearTo } },
        _min: { firstOrder: true },
        _max: { lastOrder: true },
      });
      const resetFrom = Math.min(min, previous._min.firstOrder ?? min);
      const resetTo = Math.max(max, previous._max.lastOrder ?? max);

      // This store's lines for the year, and the year's unassigned lines — both are
      // rewritten from the sheet. Other stores' lines are left alone.
      await tx.supplierLedgerEntry.deleteMany({
        where: {
          OR: [{ storeId }, { storeId: null }],
          date: { gte: yearFrom, lt: yearTo },
        },
      });
      const toEntry = (line: LedgerLine, owner: string | null, matchedOrders = 0) => ({
        storeId: owner,
        date: dayStart(line.date),
        kind: line.kind,
        label: line.label,
        reference: line.reference,
        firstOrder: line.firstOrder,
        lastOrder: line.lastOrder,
        amount: line.amount,
        matchedOrders,
      });
      await tx.supplierLedgerEntry.createMany({
        data: [
          ...bills.map((bill, index) => toEntry(bill, storeId, matchedByIndex.get(index) ?? 0)),
          ...mine
            .filter((line) => line.kind !== "bill")
            .map((line) => toEntry(line, storeId)),
          ...unassigned.map((line) => toEntry(line, null)),
        ],
      });

      // Cleared across the span first, so an order whose bill was corrected away goes
      // back to its estimate rather than keeping a stale charge.
      await tx.$executeRaw`
        UPDATE "Order" SET "supplierCostActual" = NULL
        WHERE "storeId" = ${storeId} AND "orderNumber" BETWEEN ${resetFrom} AND ${resetTo}`;

      const ordersCosted = await tx.$executeRaw`
          WITH bill AS (
            SELECT * FROM jsonb_to_recordset(${billJson}::jsonb)
              AS b(idx int, "first" int, "last" int, amount float8)
          ),
          cost AS (
            SELECT o.id, o."orderNumber",
                   COALESCE(SUM(COALESCE(li."lineCost",
                     (li."unitCogs" + li."unitShipping" + li."unitHandling") * li.quantity)), 0)::float8 AS est,
                   COALESCE(SUM(li.quantity), 0)::float8 AS units
            FROM "Order" o
            LEFT JOIN "OrderLineItem" li ON li."orderId" = o.id
            WHERE o."storeId" = ${storeId} AND o."orderNumber" BETWEEN ${min} AND ${max}
            GROUP BY o.id, o."orderNumber"
          ),
          share AS (
            SELECT c.id, b.amount, c.est, c.units,
                   SUM(c.est) OVER (PARTITION BY b.idx) AS est_total,
                   SUM(c.units) OVER (PARTITION BY b.idx) AS units_total,
                   COUNT(*) OVER (PARTITION BY b.idx)::float8 AS n
            FROM cost c
            JOIN bill b ON c."orderNumber" BETWEEN b."first" AND b."last"
          ),
          per_order AS (
            SELECT id, SUM(amount * CASE
                     WHEN est_total > 0 THEN est / est_total
                     WHEN units_total > 0 THEN units / units_total
                     ELSE 1.0 / n END) AS cost
            FROM share
            GROUP BY id
          )
          UPDATE "Order" o SET "supplierCostActual" = p.cost
          FROM per_order p
          WHERE o.id = p.id`;

      const unmatched = bills.filter((_, index) => !(matchedByIndex.get(index) ?? 0));
      const sum = (items: LedgerLine[]) => items.reduce((total, line) => total + line.amount, 0);
      const dates = mine.map((line) => line.date).sort();

      return {
        year,
        throughDate: dates.at(-1) ?? null,
        bills: bills.length,
        billed: sum(bills),
        ordersCosted,
        unmatchedBills: unmatched.length,
        unmatchedAmount: sum(unmatched),
        adjustments: adjustments.length,
        adjustmentAmount: sum(adjustments),
        unassigned: unassigned.length,
        unassignedAmount: sum(unassigned),
        overlaps: findOverlaps(bills),
      };
    },
    // A year of bills re-spreads tens of thousands of orders in one statement.
    { timeout: 120_000, maxWait: 10_000 },
  );
}
