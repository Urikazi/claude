import { prisma } from "@/lib/db";
import { buildPnlReport, previousRange, type DateRange } from "@/lib/pnl";

/**
 * The figures a media buyer turn is answered from.
 *
 * The brief wants campaign performance read at the right level and Meta's own ROAS
 * treated as one input rather than the answer, so this pulls the campaign rows the
 * dashboard actually holds and sets them beside what Shopify recorded over the same
 * days. The two will not agree — different attribution, different window — and the
 * point is to show the gap rather than hide it.
 *
 * It also carries the margin inputs, because the brief refuses to set a CPA target
 * without them and the dashboard already knows AOV, COGS and fees.
 *
 * What it cannot carry is anything below campaign level: ad sets, ads, creatives,
 * placements, audiences, bidding settings, video metrics and landing-page views are
 * not in this database at all. Those are named as missing, not left to be assumed.
 */

const money = (value: number) => value.toFixed(2);
const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? (numerator / denominator).toFixed(2) : "n/a";
const perMille = (numerator: number, denominator: number) =>
  denominator > 0 ? ((numerator / denominator) * 1000).toFixed(2) : "n/a";
const percent = (numerator: number, denominator: number) =>
  denominator > 0 ? `${((numerator / denominator) * 100).toFixed(2)}%` : "n/a";

type Row = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
};

const EMPTY: Row = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
const add = (a: Row, b: Row): Row => ({
  spend: a.spend + b.spend,
  impressions: a.impressions + b.impressions,
  clicks: a.clicks + b.clicks,
  conversions: a.conversions + b.conversions,
  conversionValue: a.conversionValue + b.conversionValue,
});

/** The derived metrics the brief asks to be evaluated, each named for what it divides. */
function metrics(row: Row, currency: string): string {
  return [
    `spend ${money(row.spend)} ${currency}`,
    `impressions ${row.impressions}`,
    `clicks ${row.clicks}`,
    `CPM ${perMille(row.spend, row.impressions)}`,
    `CPC ${ratio(row.spend, row.clicks)}`,
    `CTR ${percent(row.clicks, row.impressions)}`,
    `purchases ${row.conversions}`,
    `CPA ${ratio(row.spend, row.conversions)}`,
    `value ${money(row.conversionValue)}`,
    `ROAS ${ratio(row.conversionValue, row.spend)}`,
  ].join("  ");
}

export async function buildMediaBuyerContext(
  storeId: string,
  range: DateRange,
): Promise<string> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    include: { metaAccounts: true },
  });

  const previous = previousRange(range);
  const [report, priorReport] = await Promise.all([
    buildPnlReport(storeId, range),
    buildPnlReport(storeId, previous),
  ]);

  const [entries, sessions] = await Promise.all([
    prisma.adSpendEntry.findMany({
      where: { storeId, date: { gte: range.from, lte: range.to } },
      orderBy: { date: "asc" },
    }),
    prisma.dailyTraffic.aggregate({
      where: { storeId, date: { gte: range.from, lte: range.to } },
      _sum: { sessions: true },
    }),
  ]);

  // The brief asks for the recent window compared against the one before it, with
  // conversion lag in mind, so the split is drawn at seven days rather than averaged.
  const splitAt = new Date(range.to.getTime() - 7 * 86_400_000);
  const recent = new Map<string, Row>();
  const earlier = new Map<string, Row>();
  const byDay = new Map<string, Row>();
  for (const entry of entries) {
    const row: Row = {
      spend: entry.spend,
      impressions: entry.impressions,
      clicks: entry.clicks,
      conversions: entry.conversions,
      conversionValue: entry.conversionValue,
    };
    const name = entry.campaignName?.trim() || entry.campaignId || "unnamed";
    const bucket = entry.date >= splitAt ? recent : earlier;
    bucket.set(name, add(bucket.get(name) ?? EMPTY, row));
    const day = entry.date.toISOString().slice(0, 10);
    byDay.set(day, add(byDay.get(day) ?? EMPTY, row));
  }

  const campaigns = [...new Set([...recent.keys(), ...earlier.keys()])].sort(
    (a, b) => (recent.get(b)?.spend ?? 0) - (recent.get(a)?.spend ?? 0),
  );

  const totals = report.totals;
  // Everything a first-order break-even needs, from this store's own figures. Spelled
  // out rather than handed over as one number, because the brief asks for what each
  // calculation includes — and because the variable costs here are per order, not a
  // percentage, so a margin rate would be an invention.
  const variableCost =
    totals.cogs + totals.shippingCost + totals.handlingCost + totals.processorFees + totals.shopifyFees;
  const contributionBeforeAds = totals.netRevenue - variableCost;
  const perOrder = totals.orders > 0 ? contributionBeforeAds / totals.orders : 0;

  const missing: string[] = [
    "Ad set and ad level: not in this database. Nothing below campaign is stored, so ad-set budgets, bids, audiences, placements, individual ads and their spend cannot be read here.",
    "Creative: no ad names, thumbnails, copy, formats or video metrics. Hook rate, hold rate, thruplays and 3-second views are all absent.",
    "Funnel: landing-page views, add-to-carts, checkouts initiated and on-site conversion rate by campaign are not recorded. Sessions are counted store-wide, not per campaign.",
    "Settings: bidding strategy, cost or bid caps, budget type, exclusions and geographic structure are not stored.",
    "Subscriptions: take rate, rebills, retention and cancellations are not tracked, so no realized cohort data exists to support an LTV argument.",
    "Refunds and chargebacks are not attributed to the campaign that acquired the order.",
  ];
  const active = store.metaAccounts.filter((account) => account.active);
  if (!active.length) {
    missing.push(
      "No Meta ad account is connected to this dashboard, so any spend below was entered by hand rather than read from Meta.",
    );
  }
  const lastMeta = await prisma.syncLog.findFirst({
    where: { storeId, source: "meta" },
    orderBy: { startedAt: "desc" },
  });
  if (lastMeta?.status === "error") {
    missing.push(
      `The last Meta sync FAILED, so the campaign figures below may be stale or incomplete — treat them as such before acting on them: ${lastMeta.message ?? "no detail"}`,
    );
  }
  if (!totals.customersKnown) {
    missing.push(
      "Orders carry no customer id, so new-customer CPA and nc-ROAS cannot be computed and the brief's new-customer priority cannot be measured from this data.",
    );
  }

  return `## STORE SNAPSHOT — ${store.name} (${store.currency}, reporting in ${store.timezone})
Beauty brand. Period: ${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}.
Taken live from this store's database at ${new Date().toISOString()}. The final day may be incomplete.

### VERIFIED ACTUAL — Meta campaign performance, as Meta reported it
Attribution is Meta's own, over its own window. Derived metrics: CPM = spend/impressions x 1000, CPC = spend/clicks, CTR = clicks/impressions, CPA = spend/purchases, ROAS = value/spend. Clicks here are link clicks as the API returns them, not outbound clicks.

Last 7 days, by campaign (highest spend first):
${
    campaigns.length
      ? campaigns
          .map((name) => `  ${name}\n     now:    ${metrics(recent.get(name) ?? EMPTY, store.currency)}\n     before: ${metrics(earlier.get(name) ?? EMPTY, store.currency)}`)
          .join("\n")
      : "  No campaign rows in this period."
  }

Account total, last 7 days:   ${metrics([...recent.values()].reduce(add, EMPTY), store.currency)}
Account total, prior period:  ${metrics([...earlier.values()].reduce(add, EMPTY), store.currency)}

Daily spend (for pacing and incomplete days):
${
    [...byDay.entries()]
      .slice(-14)
      .map(([day, row]) => `  ${day}  spend ${money(row.spend)}  purchases ${row.conversions}  value ${money(row.conversionValue)}`)
      .join("\n") || "  none"
  }

### VERIFIED ACTUAL — what Shopify recorded over the same period
  Orders: ${totals.orders}   AOV: ${money(totals.aov)}   Net revenue: ${money(totals.netRevenue)}
  Discounts: ${money(totals.discounts)}   Refunds: ${money(totals.refunds)}
  Sessions (store-wide, not per campaign): ${sessions._sum.sessions ?? "not synced"}
  Blended ROAS (Shopify net revenue / all ad spend): ${ratio(totals.netRevenue, totals.adSpend)}
  ${
    !totals.customersKnown
      ? "New vs returning: UNKNOWN — orders carry no customer id."
      : totals.newCustomerOrders === 0
        // A CAC of 0.00 against no new customers reads as free acquisition. It is the
        // absence of any, which is the opposite conclusion.
        ? `New customers: NONE in this period, on ${money(totals.adSpend)} of ad spend. CAC and nc-ROAS are undefined, not zero.`
        : `New customers: ${totals.newCustomerOrders} orders, ${money(totals.newCustomerRevenue)} revenue, CAC ${money(totals.cac)}, nc-ROAS ${totals.ncRoas.toFixed(2)}, new-customer AOV ${money(totals.newCustomerAov)}`
  }
  Previous period for comparison: ${priorReport.totals.orders} orders, AOV ${money(priorReport.totals.aov)}, net revenue ${money(priorReport.totals.netRevenue)}, ad spend ${money(priorReport.totals.adSpend)}

  Meta claims ${totals.platformConversions} purchases worth ${money(totals.platformConversionValue)} on ${money(totals.platformSpend)} of its own spend (platform ROAS ${totals.platformRoas.toFixed(2)}). Shopify recorded ${totals.orders} orders worth ${money(totals.netRevenue)} net. These are different measurements of an overlapping reality — compare them, never add them.

### VERIFIED ACTUAL — the economics a break-even CPA has to be built from
  Net revenue: ${money(totals.netRevenue)} over ${totals.orders} orders
  Variable costs: COGS ${money(totals.cogs)} + fulfilment shipping ${money(totals.shippingCost)} + handling ${money(totals.handlingCost)} + processor fees ${money(totals.processorFees)} + Shopify fees ${money(totals.shopifyFees)} = ${money(variableCost)}
  Contribution before advertising: ${money(contributionBeforeAds)}, i.e. ${money(perOrder)} per order${
    variableCost === 0 && totals.orders > 0
      ? " — WARNING: variable costs came out at zero across real orders, so this is net revenue, not contribution. No break-even CPA built on it is usable until COGS and fees are loaded."
      : ""
  }
  Ad spend in period: ${money(totals.adSpend)}
  Contribution after advertising: ${money(contributionBeforeAds - totals.adSpend)}
  Excludes: overheads, payroll, software, owner compensation, interest and tax — none are in this dashboard.

### MISSING INFORMATION — not in this dashboard
${missing.map((item) => `  - ${item}`).join("\n")}`;
}
