import { prisma } from "@/lib/db";
import {
  estimateProcessorFee,
  normalizeGateway,
  round2,
  shopifyTransactionFee,
  toFeeRates,
} from "@/lib/fees";
import { buildTierTable, costOrderLines, type TierTable } from "@/lib/cost-tiers";
import * as shopify from "@/lib/integrations/shopify";
import * as meta from "@/lib/integrations/meta-ads";
import * as stripe from "@/lib/integrations/stripe";
import * as paypal from "@/lib/integrations/paypal";
import { safeTimeZone } from "@/lib/timezone";

export type SyncResult = { source: string; records: number; message: string };

/**
 * A source the user simply has not set up yet. Distinct from a failure: syncing
 * everything when only Shopify is connected is a normal, successful outcome, and
 * reporting it as an error trains people to ignore the error colour.
 */
export class NotConfiguredError extends Error {}

type StoreShopifyFields = {
  shopifyDomain: string | null;
  shopifyAccessToken: string | null;
  shopifyClientId: string | null;
  shopifyClientSecret: string | null;
};

/** Either auth style is fine; the client picks whichever the store has. */
function shopifyCredentials(store: StoreShopifyFields): shopify.ShopifyCredentials {
  const hasAuth =
    store.shopifyAccessToken || (store.shopifyClientId && store.shopifyClientSecret);
  if (!store.shopifyDomain || !hasAuth) {
    throw new NotConfiguredError("Shopify");
  }
  return {
    domain: store.shopifyDomain,
    accessToken: store.shopifyAccessToken,
    clientId: store.shopifyClientId,
    clientSecret: store.shopifyClientSecret,
  };
}

/** Empty when no price list is loaded, in which case costs stay per-unit. */
export async function loadTierTable(storeId: string): Promise<TierTable> {
  const rows = await prisma.supplierCostTier.findMany({
    where: { storeId },
    select: { sku: true, country: true, quantity: true, totalCost: true },
  });
  return buildTierTable(rows);
}

async function logSync(
  storeId: string,
  source: string,
  status: string,
  message: string,
  records: number,
  startedAt: Date,
) {
  await prisma.syncLog.create({
    data: { storeId, source, status, message, records, startedAt, endedAt: new Date() },
  });
}

export async function syncShopifyProducts(storeId: string): Promise<SyncResult> {
  const startedAt = new Date();
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const credentials = shopifyCredentials(store);
  const products = await shopify.fetchProducts(credentials);
  let count = 0;

  for (const product of products) {
    const record = await prisma.product.upsert({
      where: { storeId_shopifyId: { storeId, shopifyId: product.id } },
      create: {
        storeId,
        shopifyId: product.id,
        title: product.title,
        handle: product.handle,
        imageUrl: product.imageUrl,
      },
      update: {
        title: product.title,
        handle: product.handle,
        imageUrl: product.imageUrl,
      },
    });

    for (const variant of product.variants) {
      const existing = await prisma.productVariant.findUnique({
        where: { productId_shopifyId: { productId: record.id, shopifyId: variant.id } },
      });

      await prisma.productVariant.upsert({
        where: { productId_shopifyId: { productId: record.id, shopifyId: variant.id } },
        create: {
          productId: record.id,
          shopifyId: variant.id,
          title: variant.title,
          sku: variant.sku,
          price: variant.price,
          // Seed COGS from Shopify's inventory unit cost when the merchant maintains it.
          cogs: variant.unitCost ?? 0,
        },
        update: {
          title: variant.title,
          sku: variant.sku,
          price: variant.price,
          // Never overwrite a cost the user typed in the dashboard.
          ...(existing && existing.cogs === 0 && variant.unitCost
            ? { cogs: variant.unitCost }
            : {}),
        },
      });
      count += 1;
    }
  }

  const message = `Synced ${products.length} products / ${count} variants.`;
  await logSync(storeId, "shopify-products", "success", message, count, startedAt);
  return { source: "shopify-products", records: count, message };
}

export async function syncShopifyOrders(
  storeId: string,
  sinceDays = 60,
  full = false,
): Promise<SyncResult> {
  const startedAt = new Date();
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    include: { feeConfig: true },
  });
  const credentials = shopifyCredentials(store);
  const rates = toFeeRates(store.feeConfig);
  const tierTable = await loadTierTable(storeId);
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  /**
   * After the first run, only orders Shopify has touched since the last successful
   * sync are fetched. Re-importing every order in the window on every sync is what
   * makes a daily refresh take as long as the initial import.
   *
   * The overlap covers orders edited slightly before the previous run started, and
   * anything missed if that run half-finished.
   */
  const OVERLAP_MS = 2 * 86_400_000;
  const lastSync = full
    ? null
    : await prisma.syncLog.findFirst({
        where: { storeId, source: "shopify-orders", status: "success" },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });
  const updatedSince = lastSync
    ? new Date(Math.max(lastSync.startedAt.getTime() - OVERLAP_MS, since.getTime()))
    : undefined;

  const { orders, customerFieldAvailable, customerFieldRefusal } = await shopify.fetchOrders(
    credentials,
    since,
    updatedSince,
  );

  // Cache the variant lookup so a large import does not issue a query per line item.
  const variants = await prisma.productVariant.findMany({
    where: { product: { storeId } },
    select: { id: true, shopifyId: true, sku: true, cogs: true, shippingCost: true, handlingCost: true },
  });
  const byShopifyId = new Map(variants.filter((v) => v.shopifyId).map((v) => [v.shopifyId!, v]));
  const bySku = new Map(variants.filter((v) => v.sku).map((v) => [v.sku!, v]));

  /**
   * Writes go out in chunks rather than per order. Three round trips per order was
   * ~9,400 queries for a 3,000-order store, which overruns a serverless function's
   * time limit; batching the same work into three queries per chunk brings it back
   * to about a hundred round trips in total.
   */
  const CHUNK = 100;
  let count = 0;

  for (let start = 0; start < orders.length; start += CHUNK) {
    const chunk = orders.slice(start, start + CHUNK);

    const records = await prisma.$transaction(
      chunk.map((order) => {
        const gateway = normalizeGateway(order.paymentGatewayNames[0]);
        const netPaid = order.total - order.refunded;
        const data = {
          storeId,
          shopifyId: order.id,
          name: order.name,
          currency: order.currencyCode,
          processedAt: new Date(order.processedAt),
          financialStatus: order.displayFinancialStatus,
          shippingCountry: order.shippingCountry,
          customerId: order.customerId,
          subtotal: order.subtotal,
          discountTotal: order.discounts,
          shippingTotal: order.shipping,
          taxTotal: order.tax,
          total: order.total,
          refundedTotal: order.refunded,
          gateway,
          gatewayName: order.paymentGatewayNames.join(", ") || null,
          processorFeeEstimate: round2(estimateProcessorFee(gateway, netPaid, rates)),
          shopifyFee: round2(shopifyTransactionFee(gateway, netPaid, rates)),
        };
        return prisma.order.upsert({
          where: { storeId_shopifyId: { storeId, shopifyId: order.id } },
          create: data,
          update: data,
        });
      }),
    );

    // Line items are replaced wholesale: quantities and refunds change on an order
    // after the fact, so the previous rows cannot be trusted.
    const orderIds = records.map((record) => record.id);
    await prisma.orderLineItem.deleteMany({ where: { orderId: { in: orderIds } } });

    const lineItems = chunk.flatMap((order, index) => {
      // Priced per parcel, so the order is costed once and split back over its lines.
      const resolved = order.lineItems.map((item) => {
        const variant =
          (item.variantId ? byShopifyId.get(item.variantId) : undefined) ??
          (item.sku ? bySku.get(item.sku) : undefined);
        return { item, variant, sku: item.sku ?? variant?.sku ?? null };
      });
      const lineCosts = costOrderLines(
        tierTable,
        order.shippingCountry,
        resolved.map((r) => ({ sku: r.sku, quantity: r.item.quantity })),
      );

      return resolved.map(({ item, variant }, lineIndex) => {
        return {
          orderId: records[index].id,
          variantId: variant?.id ?? null,
          shopifyId: item.id,
          title: item.title,
          variantTitle: item.variantTitle,
          sku: item.sku,
          quantity: item.quantity,
          price: item.unitPrice,
          discountAllocated: item.discountAllocated,
          unitCogs: variant?.cogs ?? 0,
          unitShipping: variant?.shippingCost ?? 0,
          unitHandling: variant?.handlingCost ?? 0,
          lineCost: lineCosts[lineIndex],
        };
      });
    });
    if (lineItems.length) await prisma.orderLineItem.createMany({ data: lineItems });

    count += chunk.length;
  }

  const base = updatedSince
    ? `Synced ${count} new or updated orders since ${updatedSince.toISOString().slice(0, 10)}.`
    : `Synced ${count} orders since ${since.toISOString().slice(0, 10)}.`;
  // Said outright rather than left to be guessed from orders that carry no customer,
  // which looks identical to a store that simply has none.
  // Checked here rather than on the settings page so it is noticed: a wrong zone
  // produces plausible numbers that are quietly for the wrong day.
  const shopZone = await shopify.fetchShopTimeZone(credentials).catch(() => null);
  const zoneWarning =
    shopZone && shopZone !== store.timezone
      ? ` Your Shopify store reports in ${shopZone} but this dashboard is set to ${store.timezone}, so daily figures are cut at a different midnight — change the time zone in settings to match.`
      : "";

  const message = customerFieldAvailable
    ? base
    : `${base} Shopify would not say which customer placed each order, so new and returning cannot be separated — the app needs protected customer data access approved.${
        customerFieldRefusal ? ` Shopify said: ${customerFieldRefusal}` : ""
      }`;
  const finalMessage = `${message}${zoneWarning}`;
  await logSync(storeId, "shopify-orders", "success", finalMessage, count, startedAt);
  return { source: "shopify-orders", records: count, message: finalMessage };
}

export async function syncMetaAds(
  storeId: string,
  sinceDays = 60,
): Promise<SyncResult> {
  const startedAt = new Date();
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  if (!store.metaAdAccountId || !store.metaAccessToken) {
    throw new NotConfiguredError("Meta Ads");
  }

  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await meta.fetchDailySpend(
    { adAccountId: store.metaAdAccountId, accessToken: store.metaAccessToken },
    since,
    new Date(),
  );

  // Batched for the same reason as orders: a daily-by-campaign breakdown over 60
  // days is hundreds of rows, and one round trip each does not fit in a request.
  const CHUNK = 200;
  for (let start = 0; start < rows.length; start += CHUNK) {
    await prisma.$transaction(
      rows.slice(start, start + CHUNK).map((row) => {
        const date = new Date(`${row.date}T00:00:00.000Z`);
        const data = {
          storeId,
          date,
          platform: "meta",
          campaignId: row.campaignId,
          campaignName: row.campaignName,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          conversions: row.conversions,
        };
        return prisma.adSpendEntry.upsert({
          where: {
            storeId_date_platform_campaignId: {
              storeId,
              date,
              platform: "meta",
              campaignId: row.campaignId,
            },
          },
          create: data,
          update: data,
        });
      }),
    );
  }

  const message = `Synced ${rows.length} daily campaign rows.`;
  await logSync(storeId, "meta", "success", message, rows.length, startedAt);
  return { source: "meta", records: rows.length, message };
}

/// Replaces fee estimates with the real amounts Stripe and PayPal charged.
export async function reconcileProcessorFees(
  storeId: string,
  sinceDays = 60,
): Promise<SyncResult> {
  const startedAt = new Date();
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const orders = await prisma.order.findMany({
    where: { storeId, processedAt: { gte: since } },
    select: { id: true, name: true, total: true, gateway: true, processedAt: true },
  });
  const byName = new Map(orders.filter((o) => o.name).map((o) => [o.name!, o]));

  let matched = 0;
  const notes: string[] = [];

  if (store.stripeSecretKey) {
    const charges = await stripe.fetchCharges({ secretKey: store.stripeSecretKey }, since);
    for (const charge of charges) {
      const order = charge.orderRef ? byName.get(charge.orderRef) : undefined;
      const target = order ?? matchByAmount(orders, charge.amount, charge.created, "STRIPE");
      if (!target) continue;
      await prisma.order.update({
        where: { id: target.id },
        data: { processorFeeActual: round2(charge.fee) },
      });
      matched += 1;
    }
    notes.push(`Stripe: ${charges.length} charges`);
  }

  if (store.paypalClientId && store.paypalClientSecret) {
    const transactions = await paypal.fetchTransactions(
      {
        clientId: store.paypalClientId,
        clientSecret: store.paypalClientSecret,
        live: store.paypalLiveMode,
      },
      since,
      new Date(),
    );
    for (const transaction of transactions) {
      const order = transaction.orderRef ? byName.get(transaction.orderRef) : undefined;
      const target =
        order ?? matchByAmount(orders, transaction.amount, transaction.date, "PAYPAL");
      if (!target) continue;
      await prisma.order.update({
        where: { id: target.id },
        data: { processorFeeActual: round2(transaction.fee) },
      });
      matched += 1;
    }
    notes.push(`PayPal: ${transactions.length} transactions`);
  }

  if (notes.length === 0) {
    throw new NotConfiguredError("Stripe or PayPal");
  }

  const message = `${notes.join(", ")}. Matched ${matched} orders to real fees.`;
  await logSync(storeId, "fees", "success", message, matched, startedAt);
  return { source: "fees", records: matched, message };
}

/// Fallback matcher for processors that do not carry the Shopify order name.
function matchByAmount(
  orders: { id: string; total: number; gateway: string; processedAt: Date }[],
  amount: number,
  date: Date,
  gateway: string,
): { id: string } | undefined {
  return orders.find(
    (order) =>
      order.gateway === gateway &&
      Math.abs(order.total - amount) < 0.01 &&
      Math.abs(order.processedAt.getTime() - date.getTime()) < 3 * 86_400_000,
  );
}

/**
 * Recomputes supplier-tier costs on stored orders, so an imported or edited price
 * list applies to history without re-syncing from Shopify.
 *
 * Costing is per order, not per line: the supplier prices a parcel, and a
 * buy-one-get-one arrives as two lines that ship together. Lines are then updated in
 * groups sharing the same resulting cost, which keeps this to a few queries rather
 * than one per line.
 */
export async function applyCostTiers(storeId: string): Promise<number> {
  const table = await loadTierTable(storeId);
  const orders = await prisma.order.findMany({
    where: { storeId },
    select: {
      shippingCountry: true,
      lineItems: { select: { id: true, sku: true, quantity: true } },
    },
  });

  const byCost = new Map<number | null, string[]>();
  for (const order of orders) {
    const costs = costOrderLines(
      table,
      order.shippingCountry,
      order.lineItems.map((item) => ({ sku: item.sku, quantity: item.quantity })),
    );
    order.lineItems.forEach((item, index) => {
      byCost.set(costs[index], [...(byCost.get(costs[index]) ?? []), item.id]);
    });
  }

  let updated = 0;
  for (const [cost, ids] of byCost) {
    // Chunked so a store with a long tail of distinct costs cannot build a query
    // with tens of thousands of ids in it.
    for (let start = 0; start < ids.length; start += 1000) {
      const result = await prisma.orderLineItem.updateMany({
        where: { id: { in: ids.slice(start, start + 1000) } },
        data: { lineCost: cost },
      });
      if (cost !== null) updated += result.count;
    }
  }
  return updated;
}

/// Re-applies current variant costs to line items, for orders already imported.
export async function recalculateCosts(storeId: string): Promise<number> {
  const variants = await prisma.productVariant.findMany({
    where: { product: { storeId } },
    select: { id: true, cogs: true, shippingCost: true, handlingCost: true },
  });

  let updated = 0;
  for (const variant of variants) {
    const result = await prisma.orderLineItem.updateMany({
      where: { variantId: variant.id },
      data: {
        unitCogs: variant.cogs,
        unitShipping: variant.shippingCost,
        unitHandling: variant.handlingCost,
      },
    });
    updated += result.count;
  }
  return updated;
}

/// Recomputes stored fee columns after the user edits the rate configuration.
export async function recalculateFees(storeId: string): Promise<number> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    include: { feeConfig: true },
  });
  const rates = toFeeRates(store.feeConfig);
  const orders = await prisma.order.findMany({
    where: { storeId },
    select: { id: true, total: true, refundedTotal: true, gateway: true },
  });

  for (const order of orders) {
    const netPaid = order.total - order.refundedTotal;
    await prisma.order.update({
      where: { id: order.id },
      data: {
        processorFeeEstimate: round2(estimateProcessorFee(order.gateway, netPaid, rates)),
        shopifyFee: round2(shopifyTransactionFee(order.gateway, netPaid, rates)),
      },
    });
  }
  return orders.length;
}

/**
 * Daily store sessions from Shopify's analytics, which conversion rate divides by.
 *
 * Kept apart from the orders sync because it needs a different scope and can fail on
 * its own: a store without `read_reports` should still get revenue, and see a message
 * saying what to grant rather than an unexplained error.
 */
export async function syncShopifySessions(
  storeId: string,
  sinceDays = 60,
): Promise<SyncResult> {
  const startedAt = new Date();
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const credentials = shopifyCredentials(store);

  const timeZone = safeTimeZone(store.timezone);
  const until = new Date();
  const since = new Date(until.getTime() - sinceDays * 86_400_000);

  let rows: { day: string; sessions: number }[];
  try {
    rows = await shopify.fetchDailySessions(credentials, since, until);
  } catch (error) {
    if (error instanceof shopify.SessionsUnavailableError) {
      // Names the scopes the installed app really holds. A refusal plus "but I granted
      // it" almost always means the credentials in settings still point at the old app.
      const granted = await shopify
        .fetchGrantedScopes(credentials)
        .catch(() => null);
      const detail = granted
        ? granted.includes("read_reports")
          ? ` The connected app does hold read_reports, so the refusal is about protected customer data access, which analytics also requires. Scopes: ${granted.join(", ")}.`
          : ` The connected app does not hold read_reports — its scopes are: ${granted.join(", ")}. If you granted it on a new app, put that app's Client ID and Secret into settings, since these credentials still reach the old one.`
        : "";
      const message = `${error.message}${detail}`;
      await logSync(storeId, "shopify-sessions", "error", message, 0, startedAt);
      throw new NotConfiguredError(message);
    }
    throw error;
  }

  // ShopifyQL reports days in the store's own zone, and traffic is dated at the UTC
  // midnight of that day, matching how ad spend is stored so the two line up per day.
  const records = rows.map((row) => ({
    storeId,
    date: new Date(`${row.day}T00:00:00.000Z`),
    sessions: row.sessions,
  }));

  const CHUNK = 100;
  for (let start = 0; start < records.length; start += CHUNK) {
    await prisma.$transaction(
      records.slice(start, start + CHUNK).map((record) =>
        prisma.dailyTraffic.upsert({
          where: { storeId_date: { storeId, date: record.date } },
          create: record,
          update: { sessions: record.sessions },
        }),
      ),
    );
  }

  const total = records.reduce((sum, record) => sum + record.sessions, 0);
  const message = `Synced ${records.length} days of traffic (${total.toLocaleString("en-US")} sessions), ${timeZone} days.`;
  await logSync(storeId, "shopify-sessions", "success", message, records.length, startedAt);
  return { source: "shopify-sessions", records: records.length, message };
}
