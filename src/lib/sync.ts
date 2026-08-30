import { prisma } from "@/lib/db";
import {
  estimateProcessorFee,
  normalizeGateway,
  round2,
  shopifyTransactionFee,
  toFeeRates,
} from "@/lib/fees";
import * as shopify from "@/lib/integrations/shopify";
import * as meta from "@/lib/integrations/meta-ads";
import * as stripe from "@/lib/integrations/stripe";
import * as paypal from "@/lib/integrations/paypal";

export type SyncResult = { source: string; records: number; message: string };

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
    throw new Error(
      "Shopify is not configured for this store. Add the store domain plus the client ID " +
        "and secret from your app's Dev Dashboard settings.",
    );
  }
  return {
    domain: store.shopifyDomain,
    accessToken: store.shopifyAccessToken,
    clientId: store.shopifyClientId,
    clientSecret: store.shopifyClientSecret,
  };
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
): Promise<SyncResult> {
  const startedAt = new Date();
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    include: { feeConfig: true },
  });
  const credentials = shopifyCredentials(store);
  const rates = toFeeRates(store.feeConfig);
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const orders = await shopify.fetchOrders(credentials, since);

  // Cache the variant lookup so a large import does not issue a query per line item.
  const variants = await prisma.productVariant.findMany({
    where: { product: { storeId } },
    select: { id: true, shopifyId: true, sku: true, cogs: true, shippingCost: true, handlingCost: true },
  });
  const byShopifyId = new Map(variants.filter((v) => v.shopifyId).map((v) => [v.shopifyId!, v]));
  const bySku = new Map(variants.filter((v) => v.sku).map((v) => [v.sku!, v]));

  let count = 0;
  for (const order of orders) {
    const gateway = normalizeGateway(order.paymentGatewayNames[0]);
    const netPaid = order.total - order.refunded;
    const processorFeeEstimate = round2(estimateProcessorFee(gateway, netPaid, rates));
    const shopifyFee = round2(shopifyTransactionFee(gateway, netPaid, rates));

    const data = {
      storeId,
      shopifyId: order.id,
      name: order.name,
      currency: order.currencyCode,
      processedAt: new Date(order.processedAt),
      financialStatus: order.displayFinancialStatus,
      subtotal: order.subtotal,
      discountTotal: order.discounts,
      shippingTotal: order.shipping,
      taxTotal: order.tax,
      total: order.total,
      refundedTotal: order.refunded,
      gateway,
      gatewayName: order.paymentGatewayNames.join(", ") || null,
      processorFeeEstimate,
      shopifyFee,
    };

    const record = await prisma.order.upsert({
      where: { storeId_shopifyId: { storeId, shopifyId: order.id } },
      create: data,
      update: data,
    });

    // Line items are fully replaced: quantities and refunds can change on an existing order.
    await prisma.orderLineItem.deleteMany({ where: { orderId: record.id } });
    await prisma.orderLineItem.createMany({
      data: order.lineItems.map((item) => {
        const variant =
          (item.variantId ? byShopifyId.get(item.variantId) : undefined) ??
          (item.sku ? bySku.get(item.sku) : undefined);
        return {
          orderId: record.id,
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
        };
      }),
    });
    count += 1;
  }

  const message = `Synced ${count} orders since ${since.toISOString().slice(0, 10)}.`;
  await logSync(storeId, "shopify-orders", "success", message, count, startedAt);
  return { source: "shopify-orders", records: count, message };
}

export async function syncMetaAds(
  storeId: string,
  sinceDays = 60,
): Promise<SyncResult> {
  const startedAt = new Date();
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  if (!store.metaAdAccountId || !store.metaAccessToken) {
    throw new Error("Meta Ads credentials are not configured for this store.");
  }

  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await meta.fetchDailySpend(
    { adAccountId: store.metaAdAccountId, accessToken: store.metaAccessToken },
    since,
    new Date(),
  );

  for (const row of rows) {
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
    await prisma.adSpendEntry.upsert({
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
    throw new Error("No Stripe or PayPal credentials are configured for this store.");
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
