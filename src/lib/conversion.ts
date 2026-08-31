import { prisma } from "@/lib/db";
import { DEFAULT_TIME_ZONE, addDays, daysBetween, zonedDayKey } from "@/lib/timezone";
import type { DateRange } from "@/lib/pnl";
import { round2 } from "@/lib/fees";

/**
 * Conversion rate is orders divided by sessions, so it needs a traffic denominator
 * Shopify only exposes through analytics. When that has not been synced, ad clicks
 * stand in: the ratio is no longer store conversion rate, but it moves with the same
 * things and is better than an empty page. Which one is in use is reported, never
 * silently swapped, because the two are not comparable to each other.
 */
export type ConversionSource = "sessions" | "clicks";

export type ConversionDay = {
  date: string;
  visits: number;
  orders: number;
  newOrders: number;
  returningOrders: number;
  /** Orders per visit, as a percentage. */
  cvr: number;
  newCvr: number;
};

export type ConversionTotals = {
  visits: number;
  orders: number;
  newOrders: number;
  returningOrders: number;
  cvr: number;
  newCvr: number;
  returningCvr: number;
  /** Net of refunds, and summed over every order — the same figure the P&L reports. */
  revenue: number;
  newRevenue: number;
  returningRevenue: number;
};

export type ConversionReport = {
  source: ConversionSource;
  /** False when no order carries a customer, so new and returning cannot be told apart. */
  customersKnown: boolean;
  daily: ConversionDay[];
  totals: ConversionTotals;
};

const rate = (numerator: number, denominator: number): number =>
  denominator > 0 ? (numerator / denominator) * 100 : 0;

/**
 * Which orders were a customer's first.
 *
 * Taken from the earliest order we hold per customer rather than from Shopify's
 * lifetime order count, which describes the customer today rather than at the moment
 * of the order and would relabel every past order the moment someone bought again.
 *
 * Orders synced from a window that starts after a customer's real first purchase will
 * read as new. The count of orders with no customer at all is returned so a caller can
 * say how much of the split is guesswork.
 */
export async function firstOrderIds(storeId: string): Promise<Set<string>> {
  const orders = await prisma.order.findMany({
    where: { storeId, customerId: { not: null } },
    select: { id: true, customerId: true, processedAt: true },
    orderBy: { processedAt: "asc" },
  });
  const seen = new Set<string>();
  const first = new Set<string>();
  for (const order of orders) {
    if (seen.has(order.customerId!)) continue;
    seen.add(order.customerId!);
    first.add(order.id);
  }
  return first;
}

export async function buildConversionReport(
  storeId: string,
  range: DateRange,
): Promise<ConversionReport> {
  const timeZone = range.timeZone ?? DEFAULT_TIME_ZONE;
  const [orders, traffic, adSpend, firstIds] = await Promise.all([
    prisma.order.findMany({
      where: { storeId, processedAt: { gte: range.from, lte: range.to } },
      select: {
        id: true,
        processedAt: true,
        customerId: true,
        total: true,
        refundedTotal: true,
      },
    }),
    prisma.dailyTraffic.findMany({
      where: { storeId, date: { gte: range.from, lte: range.to } },
      select: { date: true, sessions: true },
    }),
    prisma.adSpendEntry.findMany({
      where: { storeId, date: { gte: range.from, lte: range.to } },
      select: { date: true, clicks: true },
    }),
    firstOrderIds(storeId),
  ]);

  const sessionTotal = traffic.reduce((sum, row) => sum + row.sessions, 0);
  const source: ConversionSource = sessionTotal > 0 ? "sessions" : "clicks";
  const customersKnown = orders.some((order) => order.customerId !== null);

  const visitsByDay = new Map<string, number>();
  if (source === "sessions") {
    for (const row of traffic) {
      const key = row.date.toISOString().slice(0, 10);
      visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + row.sessions);
    }
  } else {
    for (const row of adSpend) {
      const key = row.date.toISOString().slice(0, 10);
      visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + row.clicks);
    }
  }

  const ordersByDay = new Map<string, { all: number; fresh: number }>();
  let revenue = 0;
  let newRevenue = 0;
  for (const order of orders) {
    const key = zonedDayKey(order.processedAt, timeZone);
    const bucket = ordersByDay.get(key) ?? { all: 0, fresh: 0 };
    bucket.all += 1;
    // An order with no customer is counted as new: a guest checkout we cannot link to
    // an earlier purchase is far more often a first one than a repeat.
    const isFirst = !customersKnown || order.customerId === null || firstIds.has(order.id);
    if (isFirst) bucket.fresh += 1;
    // Revenue is every order, split for reporting only — the total below matches the
    // P&L exactly, which is the point of showing the two halves next to it.
    const net = order.total - order.refundedTotal;
    revenue += net;
    if (isFirst && customersKnown) newRevenue += net;
    ordersByDay.set(key, bucket);
  }

  const daily: ConversionDay[] = [];
  const totals = { visits: 0, orders: 0, newOrders: 0 };
  for (const date of eachDay(range, timeZone)) {
    const visits = visitsByDay.get(date) ?? 0;
    const counted = ordersByDay.get(date) ?? { all: 0, fresh: 0 };
    const newOrders = customersKnown ? counted.fresh : 0;
    daily.push({
      date,
      visits,
      orders: counted.all,
      newOrders,
      returningOrders: counted.all - newOrders,
      cvr: rate(counted.all, visits),
      newCvr: rate(newOrders, visits),
    });
    totals.visits += visits;
    totals.orders += counted.all;
    totals.newOrders += newOrders;
  }

  return {
    source,
    customersKnown,
    daily,
    totals: {
      visits: totals.visits,
      orders: totals.orders,
      newOrders: totals.newOrders,
      returningOrders: totals.orders - totals.newOrders,
      cvr: rate(totals.orders, totals.visits),
      newCvr: rate(totals.newOrders, totals.visits),
      returningCvr: rate(totals.orders - totals.newOrders, totals.visits),
      revenue: round2(revenue),
      newRevenue: round2(newRevenue),
      returningRevenue: round2(revenue - newRevenue),
    },
  };
}

function eachDay(range: DateRange, timeZone: string): string[] {
  const days: string[] = [];
  const end = zonedDayKey(range.to, timeZone);
  let key = zonedDayKey(range.from, timeZone);
  for (let i = 0; i < 800; i += 1) {
    days.push(key);
    if (key >= end) break;
    key = addDays(key, 1);
  }
  return days;
}

/** A change the operator logged, with what conversion did on either side of it. */
export type ChangeImpact = {
  id: string;
  date: string;
  title: string;
  category: string;
  note: string | null;
  /** Days compared on each side. Equal by construction — see `analyzeChanges`. */
  windowDays: number;
  before: { visits: number; orders: number; cvr: number };
  after: { visits: number; orders: number; cvr: number };
  /** Relative move in conversion rate, in percent. Null when there is nothing to compare. */
  deltaPct: number | null;
  /** Two-sided p-value from a two-proportion test. Null when a side has no traffic. */
  pValue: number | null;
  verdict: "better" | "worse" | "unclear" | "too-early" | "no-data";
};

export const DEFAULT_IMPACT_WINDOW = 7;
/** Below this many days after a change, the comparison is reported as premature. */
const MIN_DAYS_TO_JUDGE = 3;
/** Two-sided threshold under which a move is called rather than left as noise. */
const SIGNIFICANCE = 0.05;

/**
 * Compares conversion before and after each logged change.
 *
 * The two windows are always the same length, trimmed to whichever side is shorter and
 * stopped at the neighbouring change, so a comparison never spans a second edit and
 * never weighs three days against ten — a week and a weekend convert differently, and
 * unequal windows read that difference as an effect.
 *
 * This observes, it does not prove. Traffic mix, spend and season all move conversion,
 * and a change is not an experiment; the significance test only says whether a move is
 * larger than the counts alone would throw up by chance.
 */
export async function analyzeChanges(
  storeId: string,
  timeZone: string,
  windowDays = DEFAULT_IMPACT_WINDOW,
): Promise<ChangeImpact[]> {
  const changes = await prisma.storeChange.findMany({
    where: { storeId },
    orderBy: { date: "desc" },
  });
  if (!changes.length) return [];

  const dayKeys = changes.map((change) => change.date.toISOString().slice(0, 10)).sort();
  const spanFrom = addDays(dayKeys[0], -windowDays - 1);
  const spanTo = addDays(dayKeys[dayKeys.length - 1], windowDays + 1);

  const report = await buildConversionReport(storeId, {
    from: new Date(`${spanFrom}T00:00:00.000Z`),
    to: new Date(`${spanTo}T23:59:59.999Z`),
    timeZone,
  });
  const byDay = new Map(report.daily.map((day) => [day.date, day]));
  const today = zonedDayKey(new Date(), timeZone);

  // Ascending, so each change knows the one before and after it in time.
  const ordered = [...changes].sort((a, b) => a.date.getTime() - b.date.getTime());

  return ordered
    .map((change, index): ChangeImpact => {
      const day = change.date.toISOString().slice(0, 10);
      const previous = ordered[index - 1];
      const next = ordered[index + 1];

      // The change day counts as "after": an edit made in the morning shapes that day.
      const afterFloor = next
        ? addDays(next.date.toISOString().slice(0, 10), -1)
        : today;
      const afterEnd = min(addDays(day, windowDays - 1), min(afterFloor, today));
      const beforeStart = previous
        ? max(addDays(day, -windowDays), previous.date.toISOString().slice(0, 10))
        : addDays(day, -windowDays);

      // daysBetween counts both endpoints, so these are day counts already.
      const afterLen = daysBetween(day, afterEnd);
      const beforeLen = daysBetween(beforeStart, addDays(day, -1));
      const span = Math.min(afterLen, beforeLen);

      const base = {
        id: change.id,
        date: day,
        title: change.title,
        category: change.category,
        note: change.note,
      };

      if (span < 1) {
        return {
          ...base,
          windowDays: 0,
          before: { visits: 0, orders: 0, cvr: 0 },
          after: { visits: 0, orders: 0, cvr: 0 },
          deltaPct: null,
          pValue: null,
          verdict: "no-data",
        };
      }

      const after = sum(byDay, day, addDays(day, span - 1), report.customersKnown);
      const before = sum(
        byDay,
        addDays(day, -span),
        addDays(day, -1),
        report.customersKnown,
      );

      const comparable = before.visits > 0 && after.visits > 0;
      const deltaPct =
        comparable && before.cvr > 0 ? ((after.cvr - before.cvr) / before.cvr) * 100 : null;
      const pValue = comparable
        ? twoProportionPValue(before.orders, before.visits, after.orders, after.visits)
        : null;

      let verdict: ChangeImpact["verdict"] = "unclear";
      if (!comparable) verdict = "no-data";
      else if (afterLen < MIN_DAYS_TO_JUDGE) verdict = "too-early";
      else if (pValue !== null && pValue < SIGNIFICANCE) {
        verdict = after.cvr >= before.cvr ? "better" : "worse";
      }

      return { ...base, windowDays: span, before, after, deltaPct, pValue, verdict };
    })
    .reverse();
}

/** Totals the metric under test across an inclusive day span. */
function sum(
  byDay: Map<string, ConversionDay>,
  from: string,
  to: string,
  customersKnown: boolean,
): { visits: number; orders: number; cvr: number } {
  let visits = 0;
  let orders = 0;
  let key = from;
  for (let i = 0; i < 400 && key <= to; i += 1) {
    const day = byDay.get(key);
    if (day) {
      visits += day.visits;
      // New-customer conversion is what a landing page or creative actually moves;
      // repeat buyers would arrive whatever the page says.
      orders += customersKnown ? day.newOrders : day.orders;
    }
    key = addDays(key, 1);
  }
  return { visits, orders, cvr: rate(orders, visits) };
}

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

/**
 * Two-sided p-value for two conversion rates being the same, by the pooled
 * two-proportion z-test. Answers "could this gap be chance?", not "did the change
 * cause it": only a split test answers that.
 */
export function twoProportionPValue(
  ordersA: number,
  visitsA: number,
  ordersB: number,
  visitsB: number,
): number | null {
  if (visitsA <= 0 || visitsB <= 0) return null;
  const pooled = (ordersA + ordersB) / (visitsA + visitsB);
  if (pooled <= 0 || pooled >= 1) return null;
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / visitsA + 1 / visitsB));
  if (standardError === 0) return null;
  const z = (ordersB / visitsB - ordersA / visitsA) / standardError;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/** Normal CDF via Abramowitz & Stegun 7.1.26, accurate to ~1e-7 — ample here. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * z);
  const density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - density * poly;
}
