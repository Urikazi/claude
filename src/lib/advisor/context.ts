import { prisma } from "@/lib/db";
import { buildPnlReport, previousRange, type DateRange, type PnlTotals } from "@/lib/pnl";
import { toFeeRates } from "@/lib/fees";
import { addDays, endOfZonedDay, startOfZonedDay, todayInZone } from "@/lib/timezone";

/**
 * The figures a CFO turn is answered from.
 *
 * The brief asks for every input to be sorted into verified actual, estimate, or
 * missing, and refuses to let a gap be filled with a plausible number. That only holds
 * if the labelling is done here, from what the database can and cannot show, rather
 * than left to the model to guess at: it cannot tell a tiered COGS figure from one
 * standing in at the US price, or a real processor fee from a rate applied to a total.
 *
 * So each figure is emitted with its provenance attached, and the gaps are listed as
 * explicitly as the numbers.
 */

const money = (value: number) => value.toFixed(2);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function scorecard(label: string, totals: PnlTotals, currency: string): string {
  const lines = [
    `  Orders: ${totals.orders}   Units: ${totals.units}   AOV: ${money(totals.aov)} ${currency}`,
    `  Gross revenue: ${money(totals.grossRevenue)}`,
    `  Discounts: -${money(totals.discounts)}   Refunds: -${money(totals.refunds)}`,
    `  Shipping charged to customers: ${money(totals.shippingCharged)}`,
    `  Sales tax collected (excluded from net revenue): ${money(totals.taxes)}`,
    `  NET REVENUE: ${money(totals.netRevenue)}`,
    `  COGS: ${money(totals.cogs)}   (+ shipping ${money(totals.shippingCost)}, handling ${money(totals.handlingCost)})`,
    // `margin` from the P&L engine is already a percentage, and it is NET margin
    // (net profit over net revenue), not gross. Gross margin is worked out here so the
    // two are not conflated — and so neither gets multiplied by a hundred twice.
    `  GROSS PROFIT: ${money(totals.grossProfit)}   gross margin ${
      totals.netRevenue > 0 ? ((totals.grossProfit / totals.netRevenue) * 100).toFixed(1) : "0.0"
    }%`,
    `  Processor fees: ${money(totals.processorFees)}   Shopify fees: ${money(totals.shopifyFees)}`,
    `  Ad spend: ${money(totals.adSpend)}`,
    `  NET PROFIT (before overhead, payroll, tax, owner pay): ${money(totals.netProfit)}   net margin ${totals.margin.toFixed(1)}%`,
    `  Blended ROAS: ${totals.roas.toFixed(2)}   Profit-on-ad-spend: ${totals.poas.toFixed(2)}`,
  ];
  if (totals.customersKnown) {
    lines.push(
      `  New customers: ${totals.newCustomerOrders} orders, ${money(totals.newCustomerRevenue)} revenue`,
      `  CAC: ${money(totals.cac)}   New-customer AOV: ${money(totals.newCustomerAov)}   nc-ROAS: ${totals.ncRoas.toFixed(2)}`,
    );
  } else {
    lines.push("  New vs returning: UNKNOWN — no order carries a customer id.");
  }
  if (totals.platformSpend > 0) {
    lines.push(
      `  Platform-attributed (Meta's own figures, not Shopify's): ${totals.platformConversions} purchases, ${money(totals.platformConversionValue)} value, platform ROAS ${totals.platformRoas.toFixed(2)}`,
    );
  }
  return `${label}\n${lines.join("\n")}`;
}

export async function buildAdvisorContext(
  storeId: string,
  range: DateRange,
): Promise<string> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    include: { feeConfig: true, metaAccounts: true },
  });

  const previous = previousRange(range);
  const [report, priorReport] = await Promise.all([
    buildPnlReport(storeId, range),
    buildPnlReport(storeId, previous),
  ]);

  // How much of COGS rests on a real quote, rather than a stand-in or nothing at all.
  // Without this the gross margin above reads as settled when part of it is guesswork.
  const [lineTotals, tierCount, fallbackOnly, invoices, syncLogs, traffic] = await Promise.all([
    prisma.orderLineItem.groupBy({
      by: ["lineCost"],
      where: { order: { storeId, processedAt: { gte: range.from, lte: range.to } } },
      _count: { _all: true },
      _sum: { quantity: true },
    }),
    prisma.supplierCostTier.count({ where: { storeId } }),
    prisma.supplierCostTier.groupBy({
      by: ["sku"],
      where: { storeId },
      _count: { _all: true },
    }),
    prisma.supplierInvoice.findMany({
      where: { storeId },
      orderBy: { invoiceDate: "desc" },
      take: 8,
    }),
    prisma.syncLog.findMany({
      where: { storeId },
      orderBy: { startedAt: "desc" },
      take: 8,
    }),
    prisma.dailyTraffic.aggregate({
      where: { storeId, date: { gte: range.from, lte: range.to } },
      _sum: { sessions: true },
    }),
  ]);

  const uncostedLines = lineTotals
    .filter((row) => row.lineCost === null)
    .reduce((sum, row) => sum + row._count._all, 0);
  const costedLines = lineTotals
    .filter((row) => row.lineCost !== null)
    .reduce((sum, row) => sum + row._count._all, 0);

  const rates = toFeeRates(store.feeConfig);
  const fees = report.feesBreakdown;
  const metaConnected = store.metaAccounts.filter((account) => account.active).length;
  const lastMetaSync = syncLogs.find((log) => log.source === "meta");

  const missing: string[] = [];
  if (uncostedLines > 0) {
    missing.push(
      `${uncostedLines} of ${uncostedLines + costedLines} order lines in this period have no supplier price at all, so their COGS is zero and gross profit above is overstated by whatever they really cost.`,
    );
  }
  if (!tierCount) {
    missing.push("No supplier price list is loaded for this store — every line is costed at zero.");
  }
  // Fees are recorded per order at sync time. Orders synced before a processor was
  // configured carry none, which reads as "we pay no card fees" — a conclusion no CFO
  // should be allowed to draw from a blank field.
  if (report.totals.orders > 0 && report.totals.processorFees === 0) {
    missing.push(
      `${report.totals.orders} orders carry no processor fee at all, which cannot be right for card payments. The fees were most likely never recorded against these orders — treat the fee lines above as zero-filled, not as evidence of free processing.`,
    );
  }
  if (!store.feeConfig) {
    missing.push("Processor fee rates have never been set, so the defaults are in use.");
  }
  if (!store.stripeSecretKey && !store.paypalClientSecret) {
    missing.push(
      "No payment processor is connected, so every processor fee here is a rate applied to the order total — not the amount actually charged. International card surcharges and currency conversion are therefore not in these numbers.",
    );
  }
  if (!metaConnected) {
    missing.push("No Meta ad account is connected, so ad spend covers only what was entered by hand.");
  } else if (lastMetaSync?.status === "error") {
    missing.push(
      `The last Meta sync failed, so ad spend may be stale or incomplete: ${lastMetaSync.message ?? "no detail"}`,
    );
  }
  if (!report.totals.customersKnown) {
    missing.push(
      "Orders carry no customer id, so new versus returning, CAC and nc-ROAS cannot be computed from this data.",
    );
  }
  missing.push(
    "Overheads are not in this dashboard at all: payroll, contractors, software, rent, agency fees, owner compensation, interest, and corporation tax. Net profit above is before every one of them.",
    "Inventory on hand, purchase orders, supplier deposits and stock value are not tracked here, so no cash forecast can be built from this snapshot alone.",
    "Bank balances and payout timing are not available, so cash position and the 13-week forecast need a bank export.",
    "Chargebacks, disputes and their fees are not recorded separately from refunds.",
    "No subscription data is present — take rate, rebills, failed payments and cohort retention cannot be measured from this snapshot.",
  );

  const zone = store.timezone;
  return `## STORE SNAPSHOT — ${store.name} (${store.currency}, reporting in ${zone})
Period: ${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}
Compared against: ${previous.from.toISOString().slice(0, 10)} to ${previous.to.toISOString().slice(0, 10)}
Taken live from this store's database at ${new Date().toISOString()}.

### VERIFIED ACTUAL — from Shopify orders synced into this dashboard
${scorecard(`This period:`, report.totals, store.currency)}

${scorecard(`Previous period:`, priorReport.totals, store.currency)}

Sessions in period: ${traffic._sum.sessions ?? "not synced"}
Ad spend by platform: ${
    report.adSpendByPlatform.length
      ? report.adSpendByPlatform.map((row) => `${row.platform} ${money(row.spend)}`).join(", ")
      : "none recorded"
  }
Orders by gateway: ${
    fees.length
      ? fees.map((row) => `${row.gateway} ${row.orders} orders`).join(", ")
      : "none"
  }

### VERIFIED ACTUAL — supplier invoices audited against the agreed price list
${
    invoices.length
      ? invoices
          .map(
            (invoice) =>
              `  ${invoice.invoiceDate?.toISOString().slice(0, 10) ?? "undated"}: paid ${money(invoice.totalCharged)}, checked against ${money(invoice.totalExpected)} quoted, variance ${money(invoice.variance)} (${invoice.billedLines} billed lines)`,
          )
          .join("\n")
      : "  None uploaded."
  }

### ESTIMATE OR ASSUMPTION — derived, not observed
  Processor fees are modelled, not actual: Stripe/Shopify Payments at ${pct(rates.stripePercent)} + ${money(rates.stripeFixed)}, PayPal at ${pct(rates.paypalPercent)} + ${money(rates.paypalFixed)}, other gateways at ${pct(rates.defaultPercent)} + ${money(rates.defaultFixed)}.
  Shopify's own transaction fee is applied at ${pct(rates.shopifyTransactionRate)} of every order.
  COGS comes from the supplier price list by (SKU, destination, quantity). ${tierCount} prices are loaded across ${fallbackOnly.length} SKUs. Where a destination is not quoted, the US price stands in, which reads low because the US is among the cheapest destinations on these sheets.
  ${costedLines} order lines in this period were costed from the list; ${uncostedLines} were not costed at all.
  Platform-attributed purchases and value are Meta's own attribution over its own window. They do not reconcile to Shopify orders and must not be added to them.

### MISSING INFORMATION — not in this dashboard
${missing.map((item) => `  - ${item}`).join("\n")}`;
}

/** The last `days` reporting days, bounded by the store's own day boundaries. */
export function advisorRange(store: { timezone: string }, days: number): DateRange {
  const today = todayInZone(store.timezone);
  return {
    from: startOfZonedDay(addDays(today, -(days - 1)), store.timezone),
    to: endOfZonedDay(today, store.timezone),
    timeZone: store.timezone,
  };
}
