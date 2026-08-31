import { prisma } from "@/lib/db";
import { DEFAULT_TIME_ZONE, addDays, zonedDayKey } from "@/lib/timezone";
import { round2 } from "@/lib/fees";
import { isVariantCosted } from "@/lib/cost-tiers";

/** `timeZone` decides which calendar day an order falls on; UTC when unset. */
export type DateRange = { from: Date; to: Date; timeZone?: string };

export type PnlTotals = {
  orders: number;
  units: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  shippingCharged: number;
  taxes: number;
  netRevenue: number;
  cogs: number;
  shippingCost: number;
  handlingCost: number;
  processorFees: number;
  shopifyFees: number;
  adSpend: number;
  grossProfit: number;
  netProfit: number;
  margin: number;
  roas: number;
  poas: number;
  aov: number;
  cpa: number;
};

export type PnlDaily = PnlTotals & { date: string };

export type PnlReport = {
  totals: PnlTotals;
  daily: PnlDaily[];
  adSpendByPlatform: { platform: string; spend: number }[];
  feesBreakdown: { gateway: string; orders: number; fees: number }[];
};

const EMPTY: Omit<PnlTotals, "margin" | "roas" | "poas" | "aov" | "cpa"> = {
  orders: 0,
  units: 0,
  grossRevenue: 0,
  discounts: 0,
  refunds: 0,
  shippingCharged: 0,
  taxes: 0,
  netRevenue: 0,
  cogs: 0,
  shippingCost: 0,
  handlingCost: 0,
  processorFees: 0,
  shopifyFees: 0,
  adSpend: 0,
  grossProfit: 0,
  netProfit: 0,
};

function dayKey(date: Date, timeZone?: string): string {
  return zonedDayKey(date, timeZone ?? DEFAULT_TIME_ZONE);
}

/**
 * Ad spend is stored against a calendar date the platform reported, not an instant,
 * so it is read back as that date rather than converted between zones.
 */
function adSpendDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/// Derives the ratios that only make sense once the sums are final.
function finalize(base: typeof EMPTY): PnlTotals {
  const totalCogs = base.cogs + base.shippingCost + base.handlingCost;
  const totalFees = base.processorFees + base.shopifyFees;
  const grossProfit = base.netRevenue - totalCogs - totalFees;
  const netProfit = grossProfit - base.adSpend;

  return {
    ...base,
    grossProfit: round2(grossProfit),
    netProfit: round2(netProfit),
    grossRevenue: round2(base.grossRevenue),
    discounts: round2(base.discounts),
    refunds: round2(base.refunds),
    shippingCharged: round2(base.shippingCharged),
    taxes: round2(base.taxes),
    netRevenue: round2(base.netRevenue),
    cogs: round2(base.cogs),
    shippingCost: round2(base.shippingCost),
    handlingCost: round2(base.handlingCost),
    processorFees: round2(base.processorFees),
    shopifyFees: round2(base.shopifyFees),
    adSpend: round2(base.adSpend),
    margin: base.netRevenue > 0 ? round2((netProfit / base.netRevenue) * 100) : 0,
    roas: base.adSpend > 0 ? round2(base.netRevenue / base.adSpend) : 0,
    // Profit on ad spend: how much net profit each currency unit of ads returned.
    poas: base.adSpend > 0 ? round2(grossProfit / base.adSpend) : 0,
    aov: base.orders > 0 ? round2(base.netRevenue / base.orders) : 0,
    cpa: base.orders > 0 ? round2(base.adSpend / base.orders) : 0,
  };
}

export async function buildPnlReport(
  storeId: string,
  range: DateRange,
): Promise<PnlReport> {
  const [orders, adSpend] = await Promise.all([
    prisma.order.findMany({
      where: {
        storeId,
        processedAt: { gte: range.from, lte: range.to },
      },
      include: { lineItems: true },
      orderBy: { processedAt: "asc" },
    }),
    prisma.adSpendEntry.findMany({
      where: { storeId, date: { gte: range.from, lte: range.to } },
    }),
  ]);

  const buckets = new Map<string, typeof EMPTY>();
  const bucket = (key: string) => {
    let found = buckets.get(key);
    if (!found) {
      found = { ...EMPTY };
      buckets.set(key, found);
    }
    return found;
  };

  const totals = { ...EMPTY };
  const feesByGateway = new Map<string, { orders: number; fees: number }>();

  for (const order of orders) {
    const day = bucket(dayKey(order.processedAt, range.timeZone));

    // The processor's real fee when we reconciled it, otherwise the configured estimate.
    const processorFee = order.processorFeeActual ?? order.processorFeeEstimate;
    const netRevenue = order.total - order.refundedTotal;

    let cogs = 0;
    let shippingCost = 0;
    let handlingCost = 0;
    let units = 0;
    for (const item of order.lineItems) {
      units += item.quantity;
      if (item.lineCost !== null) {
        // Supplier tier price: one all-in total for the line, already covering
        // shipping, so it must not be scaled by quantity again.
        cogs += item.lineCost;
      } else {
        cogs += item.unitCogs * item.quantity;
        shippingCost += item.unitShipping * item.quantity;
        handlingCost += item.unitHandling * item.quantity;
      }
    }

    for (const target of [totals, day]) {
      target.orders += 1;
      target.units += units;
      // Shopify's gross sales: line items at full price, before any discount.
      // The stored subtotal already has discounts taken off, so they go back on.
      target.grossRevenue += order.subtotal + order.discountTotal;
      target.discounts += order.discountTotal;
      target.refunds += order.refundedTotal;
      target.shippingCharged += order.shippingTotal;
      target.taxes += order.taxTotal;
      target.netRevenue += netRevenue;
      target.cogs += cogs;
      target.shippingCost += shippingCost;
      target.handlingCost += handlingCost;
      target.processorFees += processorFee;
      target.shopifyFees += order.shopifyFee;
    }

    const gatewayEntry = feesByGateway.get(order.gateway) ?? { orders: 0, fees: 0 };
    gatewayEntry.orders += 1;
    gatewayEntry.fees += processorFee + order.shopifyFee;
    feesByGateway.set(order.gateway, gatewayEntry);
  }

  const spendByPlatform = new Map<string, number>();
  for (const entry of adSpend) {
    totals.adSpend += entry.spend;
    bucket(adSpendDayKey(entry.date)).adSpend += entry.spend;
    spendByPlatform.set(
      entry.platform,
      (spendByPlatform.get(entry.platform) ?? 0) + entry.spend,
    );
  }

  const daily: PnlDaily[] = [];
  for (const date of eachDay(range)) {
    const base = buckets.get(date) ?? { ...EMPTY };
    daily.push({ date, ...finalize(base) });
  }

  return {
    totals: finalize(totals),
    daily,
    adSpendByPlatform: [...spendByPlatform.entries()]
      .map(([platform, spend]) => ({ platform, spend: round2(spend) }))
      .sort((a, b) => b.spend - a.spend),
    feesBreakdown: [...feesByGateway.entries()]
      .map(([gateway, value]) => ({ gateway, orders: value.orders, fees: round2(value.fees) }))
      .sort((a, b) => b.fees - a.fees),
  };
}

function eachDay(range: DateRange): string[] {
  // Walked as calendar keys rather than by adding 24 hours, which would skip or
  // repeat a day across a daylight-saving change.
  const days: string[] = [];
  const end = dayKey(range.to, range.timeZone);
  let key = dayKey(range.from, range.timeZone);
  // Guard against a reversed or absurd range producing an unbounded loop.
  for (let i = 0; i < 800; i += 1) {
    days.push(key);
    if (key >= end) break;
    key = addDays(key, 1);
  }
  return days;
}

/// Per-product profitability over the range, driven by line-item COGS snapshots.
export async function buildProductPnl(storeId: string, range: DateRange) {
  const items = await prisma.orderLineItem.findMany({
    where: { order: { storeId, processedAt: { gte: range.from, lte: range.to } } },
    include: { variant: { include: { product: true } } },
  });

  const rows = new Map<
    string,
    {
      key: string;
      title: string;
      sku: string | null;
      units: number;
      revenue: number;
      cogs: number;
      profit: number;
      margin: number;
      hasCost: boolean;
    }
  >();

  for (const item of items) {
    const key = item.variantId ?? `unlinked:${item.title}`;
    const row =
      rows.get(key) ??
      {
        key,
        title: item.variant?.product.title
          ? `${item.variant.product.title}${
              item.variant.title && item.variant.title !== "Default Title"
                ? ` — ${item.variant.title}`
                : ""
            }`
          : item.title,
        sku: item.sku,
        units: 0,
        revenue: 0,
        cogs: 0,
        profit: 0,
        margin: 0,
        hasCost: false,
      };

    const revenue = item.price * item.quantity - item.discountAllocated;
    const cost =
      item.lineCost ??
      (item.unitCogs + item.unitShipping + item.unitHandling) * item.quantity;

    row.units += item.quantity;
    row.revenue += revenue;
    row.cogs += cost;
    if (cost > 0) row.hasCost = true;
    rows.set(key, row);
  }

  return [...rows.values()]
    .map((row) => {
      const profit = row.revenue - row.cogs;
      return {
        ...row,
        revenue: round2(row.revenue),
        cogs: round2(row.cogs),
        profit: round2(profit),
        margin: row.revenue > 0 ? round2((profit / row.revenue) * 100) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * The equivalent window immediately before this one, same length.
 *
 * A profit figure on its own says nothing about whether the week went well; the
 * comparison is what makes it a number worth acting on.
 */
export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime() + 1;
  return {
    from: new Date(range.from.getTime() - span),
    to: new Date(range.from.getTime() - 1),
    timeZone: range.timeZone,
  };
}

/** Percentage change, or null when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Variants that no cost can be found for, which is what the overview warns about.
 *
 * Counting `ProductVariant.cogs = 0` in SQL would be cheaper but wrong: the cost
 * editor and imported price lists both write tiers, leaving that column at zero on
 * variants that are fully costed.
 */
export async function countUncostedVariants(storeId: string): Promise<number> {
  const [variants, priced] = await Promise.all([
    prisma.productVariant.findMany({
      where: { product: { storeId } },
      select: { sku: true, cogs: true },
    }),
    prisma.supplierCostTier.findMany({
      where: { storeId },
      select: { sku: true },
      distinct: ["sku"],
    }),
  ]);
  const pricedSkus = new Set(priced.map((tier) => tier.sku));
  return variants.filter((variant) => !isVariantCosted(pricedSkus, variant)).length;
}
