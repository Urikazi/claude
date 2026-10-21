import { prisma } from "@/lib/db";
import { buildPnlReport, previousRange, type DateRange } from "@/lib/pnl";
import { analyzeChanges, buildConversionReport } from "@/lib/conversion";
import { CHANGE_CATEGORIES } from "@/lib/change-categories";

/**
 * The figures a CRO turn is answered from.
 *
 * The brief opens its analytics section with a funnel this database does not hold:
 * add-to-cart, reached-checkout and checkout-completion rates live in Shopify
 * Analytics, not here. Rather than let those be estimated from sessions and orders —
 * which would produce a confident number for a stage nobody measured — the snapshot
 * reports the two stages it does have and names the rest as missing.
 *
 * What it adds that a page audit cannot get from a screenshot is the money: the
 * contribution behind each order, so a recommendation that lifts conversion by
 * discounting can be checked against what is left to discount, and revenue per visit,
 * which is the figure a change actually has to move.
 *
 * The change log is the other half. Each logged edit is already measured against the
 * days either side of it, so the brief's demand for evidence has something real to
 * point at — including the edits that moved nothing.
 */

const money = (value: number) => value.toFixed(2);
const percent = (numerator: number, denominator: number) =>
  denominator > 0 ? `${((numerator / denominator) * 100).toFixed(2)}%` : "n/a";

const CATEGORY_LABELS = new Map<string, string>(
  CHANGE_CATEGORIES.map((category) => [category.value, category.label]),
);

const VERDICTS: Record<string, string> = {
  better: "likely better",
  worse: "likely worse",
  unclear: "within noise",
  "too-early": "too early to read",
  "no-data": "no traffic to read",
};

export async function buildCroContext(storeId: string, range: DateRange): Promise<string> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return "No store found.";

  const earlier = previousRange(range);
  const [report, prior, pnl, changes] = await Promise.all([
    buildConversionReport(storeId, range),
    buildConversionReport(storeId, earlier),
    buildPnlReport(storeId, range),
    analyzeChanges(storeId, store.timezone),
  ]);

  const now = report.totals;
  const was = prior.totals;
  const lines: string[] = [];

  const days = Math.max(
    1,
    Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1,
  );
  const window = `${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}`;

  lines.push(`# ${store.name} — conversion snapshot`);
  lines.push(
    `Window: ${window} (${days} days), against the ${days} days before it. Currency ${store.currency}.`,
  );

  // Which denominator is in play decides what the rate even means, so it is stated
  // before any figure drawn from it.
  lines.push(
    report.source === "sessions"
      ? "\nVisits are Shopify sessions, so these are store conversion rates."
      : "\nNo Shopify sessions are synced, so visits are **ad clicks** and these are not store conversion rates — they are clicks-to-order. Say so before quoting any rate, and ask for the read_reports scope to be granted so sessions sync.",
  );

  lines.push(`
## Funnel, as far as this database reaches

| Stage | Last ${days}d | Prior ${days}d |
|---|---:|---:|
| Visits | ${now.visits} | ${was.visits} |
| Orders | ${now.orders} | ${was.orders} |
| New-customer orders | ${now.newOrders} | ${was.newOrders} |
| Returning orders | ${now.returningOrders} | ${was.returningOrders} |
| Conversion rate | ${now.cvr.toFixed(2)}% | ${was.cvr.toFixed(2)}% |
| New-customer CVR | ${now.newCvr.toFixed(2)}% | ${was.newCvr.toFixed(2)}% |
| AOV | ${money(now.aov)} | ${money(was.aov)} |
| New-customer AOV | ${money(now.newAov)} | ${money(was.newAov)} |
| Returning AOV | ${money(now.returningAov)} | ${money(was.returningAov)} |
| Revenue per visit | ${money(now.revenuePerVisit)} | ${money(was.revenuePerVisit)} |
| Net revenue | ${money(now.revenue)} | ${money(was.revenue)} |`);

  if (!report.customersKnown) {
    lines.push(
      "\nNo order carries a customer, so new and returning cannot be told apart in this window — treat the split above as unavailable rather than as zero.",
    );
  }
  if (report.unattributedOrders > 0) {
    lines.push(
      `\n${report.unattributedOrders} order(s) were synced before Shopify's lifetime customer count was read, so their first-purchase status is inferred from the orders held rather than known.`,
    );
  }

  const t = pnl.totals;
  const contributionPerOrder = t.orders > 0 ? t.grossProfit / t.orders : 0;
  const contributionPerVisit = now.visits > 0 ? t.grossProfit / now.visits : 0;
  lines.push(`
## What a conversion is worth

Figures below are from the same window's P&L. Contribution is net revenue less product, shipping, handling and payment fees, before ad spend — what each order has available to pay for acquisition, a discount, or a free second stick.

| Measure | Value |
|---|---:|
| Orders | ${t.orders} |
| Net revenue | ${money(t.netRevenue)} |
| Product + fulfilment cost | ${money(t.cogs + t.shippingCost + t.handlingCost)} |
| Payment + platform fees | ${money(t.processorFees + t.shopifyFees)} |
| Contribution (before ad spend) | ${money(t.grossProfit)} |
| Contribution per order | ${money(contributionPerOrder)} |
| Contribution per visit | ${money(contributionPerVisit)} |
| Ad spend | ${money(t.adSpend)} |
| Net profit after ad spend | ${money(t.netProfit)} |
| Discounts given | ${money(t.discounts)} |
| Refunds | ${money(t.refunds)} (${percent(t.refunds, t.grossRevenue)} of gross revenue) |`);

  if (t.processorFees === 0 && t.orders > 0) {
    lines.push(
      "\nProcessor fees read as zero against real orders, which no payment provider charges — the fee settings are unset, so contribution above is overstated. Say so before resting an offer recommendation on it.",
    );
  }

  const recent = changes.slice(0, 12);
  if (recent.length) {
    lines.push(`
## Change log — every logged edit, measured

Each is compared against an equal number of days either side, stopping at the next change. This is observation, not experiment: traffic mix, spend and season move conversion too.

| Date | Change | Category | CVR before | CVR after | Move | Read |
|---|---|---|---:|---:|---:|---|`);
    for (const change of recent) {
      const move =
        change.deltaPct === null
          ? "—"
          : `${change.deltaPct >= 0 ? "+" : ""}${change.deltaPct.toFixed(1)}%`;
      lines.push(
        `| ${change.date} | ${change.title.replace(/\|/g, "/")} | ${
          CATEGORY_LABELS.get(change.category) ?? change.category
        } | ${change.before.cvr.toFixed(2)}% | ${change.after.cvr.toFixed(2)}% | ${move} | ${
          VERDICTS[change.verdict] ?? change.verdict
        }${change.pValue !== null ? `, p ${change.pValue < 0.001 ? "<0.001" : change.pValue.toFixed(3)}` : ""} |`,
      );
    }
    const noted = recent.filter((change) => change.note);
    if (noted.length) {
      lines.push("\nNotes on those changes:");
      for (const change of noted) lines.push(`- ${change.date} — ${change.title}: ${change.note}`);
    }
  } else {
    lines.push(
      "\n## Change log\n\nNothing logged. No edit to the site, the offer or the creative has been recorded, so there is no measured before-and-after to reason from — every claim about what a past change did would be a guess.",
    );
  }

  lines.push(`
## Not in this database

Do not estimate any of these from the figures above. Name the ones that would change your answer, and where to get them.

- Add-to-cart rate, reached-checkout rate, checkout completion rate, product-view rate, landing-page-view rate (Shopify Analytics → Reports → Sessions by… / Conversion over time)
- Bounce or engagement rate, time on page, scroll depth
- Mobile versus desktop split, traffic source split, country split
- Heatmaps, session recordings, form analytics
- Chargeback rate, subscription take rate
- The pages themselves: theme, copy, images, shade selector, cart drawer and checkout are not readable from here — they must be pasted or attached
- Ad creative, ad copy, and which ad sent which visitor — so a message-match verdict needs the ad pasted beside the page`);

  return lines.join("\n");
}
