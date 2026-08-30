import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FEE_DEFAULTS = {
  shopifyTransactionRate: 0.006,
  stripePercent: 0.029,
  stripeFixed: 0.3,
  paypalPercent: 0.0349,
  paypalFixed: 0.49,
  defaultPercent: 0,
  defaultFixed: 0,
};

const CATALOG = [
  { title: "Everyday Hoodie", price: 68, cogs: 19.5, variants: ["S", "M", "L", "XL"] },
  { title: "Merino Beanie", price: 34, cogs: 8.25, variants: ["One size"] },
  { title: "Canvas Weekender", price: 129, cogs: 41, variants: ["Black", "Olive"] },
  { title: "Ribbed Socks 3-Pack", price: 22, cogs: 5.4, variants: ["One size"] },
  { title: "Insulated Bottle 750ml", price: 39, cogs: 11.8, variants: ["Steel", "Matte black"] },
];

const CAMPAIGNS = [
  { id: "23851", name: "Prospecting — Broad" },
  { id: "23852", name: "Retargeting — 7d viewers" },
  { id: "23853", name: "Advantage+ Shopping" },
];

// Deterministic PRNG so re-seeding produces the same demo numbers.
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function estimateFee(gateway: string, amount: number) {
  if (gateway === "STRIPE" || gateway === "SHOPIFY_PAYMENTS") {
    return amount * FEE_DEFAULTS.stripePercent + FEE_DEFAULTS.stripeFixed;
  }
  if (gateway === "PAYPAL") {
    return amount * FEE_DEFAULTS.paypalPercent + FEE_DEFAULTS.paypalFixed;
  }
  return 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function main() {
  const random = makeRandom(20260830);

  await prisma.store.deleteMany({ where: { name: "Demo Store" } });

  const store = await prisma.store.create({
    data: {
      name: "Demo Store",
      currency: "USD",
      feeConfig: { create: FEE_DEFAULTS },
    },
  });

  const variantPool: {
    id: string;
    title: string;
    variantTitle: string;
    price: number;
    cogs: number;
    shipping: number;
    handling: number;
  }[] = [];

  for (const [index, item] of CATALOG.entries()) {
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        shopifyId: `gid://shopify/Product/${8000 + index}`,
        title: item.title,
        handle: item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      },
    });

    for (const [variantIndex, variantTitle] of item.variants.entries()) {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          shopifyId: `gid://shopify/ProductVariant/${90000 + index * 10 + variantIndex}`,
          title: variantTitle,
          sku: `${item.title.slice(0, 3).toUpperCase()}-${variantTitle.slice(0, 3).toUpperCase()}`,
          price: item.price,
          cogs: item.cogs,
          shippingCost: 4.2,
          handlingCost: 0.85,
        },
      });
      variantPool.push({
        id: variant.id,
        title: item.title,
        variantTitle,
        price: item.price,
        cogs: item.cogs,
        shipping: 4.2,
        handling: 0.85,
      });
    }
  }

  const gateways = ["STRIPE", "PAYPAL", "SHOPIFY_PAYMENTS", "STRIPE", "STRIPE"];
  const days = 90;
  let orderNumber = 1001;

  for (let dayOffset = days - 1; dayOffset >= 0; dayOffset -= 1) {
    const date = new Date();
    date.setUTCHours(12, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - dayOffset);

    // Weekends run lighter, and volume trends up over the window.
    const weekend = [0, 6].includes(date.getUTCDay());
    const trend = 1 + (days - dayOffset) / days;
    const orderCount = Math.max(
      1,
      Math.round((weekend ? 4 : 7) * trend * (0.7 + random() * 0.6)),
    );

    for (let i = 0; i < orderCount; i += 1) {
      const gateway = gateways[Math.floor(random() * gateways.length)];
      const lineCount = random() < 0.35 ? 2 : 1;
      const picks = Array.from(
        { length: lineCount },
        () => variantPool[Math.floor(random() * variantPool.length)],
      );

      let subtotal = 0;
      const lineItems = picks.map((variant, index) => {
        const quantity = random() < 0.2 ? 2 : 1;
        subtotal += variant.price * quantity;
        return {
          shopifyId: `gid://shopify/LineItem/${orderNumber}-${index}`,
          variantId: variant.id,
          title: variant.title,
          variantTitle: variant.variantTitle,
          quantity,
          price: variant.price,
          discountAllocated: 0,
          unitCogs: variant.cogs,
          unitShipping: variant.shipping,
          unitHandling: variant.handling,
        };
      });

      const discount = random() < 0.3 ? round2(subtotal * 0.1) : 0;
      const shipping = subtotal > 75 ? 0 : 6.95;
      const tax = round2((subtotal - discount) * 0.08);
      const total = round2(subtotal - discount + shipping + tax);
      // Roughly one order in twenty comes back as a refund.
      const refunded = random() < 0.05 ? total : 0;
      const netPaid = total - refunded;

      const processorFeeEstimate = round2(estimateFee(gateway, netPaid));
      const shopifyFee = round2(
        gateway === "SHOPIFY_PAYMENTS" ? 0 : netPaid * FEE_DEFAULTS.shopifyTransactionRate,
      );

      await prisma.order.create({
        data: {
          storeId: store.id,
          shopifyId: `gid://shopify/Order/${orderNumber}`,
          name: `#${orderNumber}`,
          currency: "USD",
          processedAt: date,
          financialStatus: refunded > 0 ? "refunded" : "paid",
          subtotal: round2(subtotal),
          discountTotal: discount,
          shippingTotal: shipping,
          taxTotal: tax,
          total,
          refundedTotal: refunded,
          gateway,
          gatewayName: gateway.toLowerCase(),
          processorFeeEstimate,
          // Stripe orders are reconciled to a slightly different real fee.
          processorFeeActual:
            gateway === "STRIPE" ? round2(processorFeeEstimate * 1.02) : null,
          shopifyFee,
          lineItems: { create: lineItems },
        },
      });
      orderNumber += 1;
    }

    for (const campaign of CAMPAIGNS) {
      const spend = round2((weekend ? 45 : 80) * trend * (0.6 + random() * 0.8));
      const impressions = Math.round(spend * (180 + random() * 120));
      const clicks = Math.round(impressions * (0.008 + random() * 0.012));
      await prisma.adSpendEntry.create({
        data: {
          storeId: store.id,
          date: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
          platform: "meta",
          campaignId: campaign.id,
          campaignName: campaign.name,
          spend,
          impressions,
          clicks,
          conversions: Math.round(clicks * (0.02 + random() * 0.03)),
        },
      });
    }
  }

  const orders = await prisma.order.count({ where: { storeId: store.id } });
  console.log(`Seeded "${store.name}": ${variantPool.length} variants, ${orders} orders, 90 days of Meta spend.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
