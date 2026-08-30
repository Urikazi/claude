"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DEFAULT_FEE_CONFIG } from "@/lib/fees";
import {
  recalculateCosts,
  recalculateFees,
  reconcileProcessorFees,
  syncMetaAds,
  syncShopifyOrders,
  syncShopifyProducts,
} from "@/lib/sync";

export type ActionState = { ok: boolean; message: string } | null;

const numeric = z.coerce.number().min(0).finite();

const costSchema = z.object({
  variantId: z.string().min(1),
  cogs: numeric,
  shippingCost: numeric,
  handlingCost: numeric,
});

export async function updateVariantCosts(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = costSchema.safeParse({
    variantId: formData.get("variantId"),
    cogs: formData.get("cogs"),
    shippingCost: formData.get("shippingCost"),
    handlingCost: formData.get("handlingCost"),
  });
  if (!parsed.success) return { ok: false, message: "Costs must be positive numbers." };

  const { variantId, ...costs } = parsed.data;
  await prisma.productVariant.update({ where: { id: variantId }, data: costs });

  // Existing line items keep a cost snapshot, so push the new numbers onto them too.
  await prisma.orderLineItem.updateMany({
    where: { variantId },
    data: {
      unitCogs: costs.cogs,
      unitShipping: costs.shippingCost,
      unitHandling: costs.handlingCost,
    },
  });

  revalidatePath("/dashboard/products");
  revalidatePath("/dashboard");
  return { ok: true, message: "Saved." };
}

const credentialsSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().min(1).max(3),
  shopifyDomain: z.string().optional(),
  shopifyClientId: z.string().optional(),
  shopifyClientSecret: z.string().optional(),
  shopifyAccessToken: z.string().optional(),
  metaAdAccountId: z.string().optional(),
  metaAccessToken: z.string().optional(),
  stripeSecretKey: z.string().optional(),
  paypalClientId: z.string().optional(),
  paypalClientSecret: z.string().optional(),
  paypalLiveMode: z.boolean(),
});

/// A blank secret field means "leave the stored value alone", not "clear it".
function keepIfBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The optional legacy field takes a permanent `shpat_` token. Pasting the client
 * secret (`shpss_`) there instead is the easy mistake, and it surfaces much later as
 * an opaque 401 mid-sync, so name the right field now.
 */
function describeShopifyTokenProblem(token: string | undefined): string | null {
  if (!token) return null;
  if (/^shp(at|ca|pa)_/.test(token)) return null;
  if (token.startsWith("shpss_")) {
    return "That is a client secret, not an access token. Put it in the 'Client secret' field and leave the access token blank.";
  }
  return "Admin API access tokens start with shpat_. Leave this blank unless you have a legacy custom app.";
}

export async function updateStoreSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse({
    storeId: formData.get("storeId"),
    name: formData.get("name"),
    currency: formData.get("currency"),
    shopifyDomain: formData.get("shopifyDomain")?.toString(),
    shopifyClientId: formData.get("shopifyClientId")?.toString(),
    shopifyClientSecret: formData.get("shopifyClientSecret")?.toString(),
    shopifyAccessToken: formData.get("shopifyAccessToken")?.toString(),
    metaAdAccountId: formData.get("metaAdAccountId")?.toString(),
    metaAccessToken: formData.get("metaAccessToken")?.toString(),
    stripeSecretKey: formData.get("stripeSecretKey")?.toString(),
    paypalClientId: formData.get("paypalClientId")?.toString(),
    paypalClientSecret: formData.get("paypalClientSecret")?.toString(),
    paypalLiveMode: formData.get("paypalLiveMode") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Check the store name and currency." };

  const data = parsed.data;

  const tokenError = describeShopifyTokenProblem(keepIfBlank(data.shopifyAccessToken));
  if (tokenError) return { ok: false, message: tokenError };

  await prisma.store.update({
    where: { id: data.storeId },
    data: {
      name: data.name,
      currency: data.currency.toUpperCase(),
      shopifyDomain: keepIfBlank(data.shopifyDomain),
      shopifyClientId: keepIfBlank(data.shopifyClientId),
      shopifyClientSecret: keepIfBlank(data.shopifyClientSecret),
      shopifyAccessToken: keepIfBlank(data.shopifyAccessToken),
      metaAdAccountId: keepIfBlank(data.metaAdAccountId),
      metaAccessToken: keepIfBlank(data.metaAccessToken),
      stripeSecretKey: keepIfBlank(data.stripeSecretKey),
      paypalClientId: keepIfBlank(data.paypalClientId),
      paypalClientSecret: keepIfBlank(data.paypalClientSecret),
      paypalLiveMode: data.paypalLiveMode,
    },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Settings saved." };
}

const rate = z.coerce.number().min(0).max(100);

export async function updateFeeConfig(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const storeId = formData.get("storeId")?.toString();
  if (!storeId) return { ok: false, message: "Missing store." };

  const parsed = z
    .object({
      shopifyTransactionRate: rate,
      stripePercent: rate,
      stripeFixed: z.coerce.number().min(0),
      paypalPercent: rate,
      paypalFixed: z.coerce.number().min(0),
      defaultPercent: rate,
      defaultFixed: z.coerce.number().min(0),
    })
    .safeParse({
      shopifyTransactionRate: formData.get("shopifyTransactionRate"),
      stripePercent: formData.get("stripePercent"),
      stripeFixed: formData.get("stripeFixed"),
      paypalPercent: formData.get("paypalPercent"),
      paypalFixed: formData.get("paypalFixed"),
      defaultPercent: formData.get("defaultPercent"),
      defaultFixed: formData.get("defaultFixed"),
    });
  if (!parsed.success) return { ok: false, message: "Fee rates must be valid numbers." };

  // The form collects percentages for readability; storage is fractional.
  const values = {
    shopifyTransactionRate: parsed.data.shopifyTransactionRate / 100,
    stripePercent: parsed.data.stripePercent / 100,
    stripeFixed: parsed.data.stripeFixed,
    paypalPercent: parsed.data.paypalPercent / 100,
    paypalFixed: parsed.data.paypalFixed,
    defaultPercent: parsed.data.defaultPercent / 100,
    defaultFixed: parsed.data.defaultFixed,
  };

  await prisma.feeConfig.upsert({
    where: { storeId },
    create: { storeId, ...DEFAULT_FEE_CONFIG, ...values },
    update: values,
  });

  const updated = await recalculateFees(storeId);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: `Saved. Recalculated fees on ${updated} orders.` };
}

export async function runSync(
  storeId: string,
  source: "shopify-products" | "shopify-orders" | "meta" | "fees" | "all",
  days = 60,
): Promise<ActionState> {
  const tasks: (() => Promise<{ message: string }>)[] = [];
  if (source === "all" || source === "shopify-products") {
    tasks.push(() => syncShopifyProducts(storeId));
  }
  if (source === "all" || source === "shopify-orders") {
    tasks.push(() => syncShopifyOrders(storeId, days));
  }
  if (source === "all" || source === "meta") tasks.push(() => syncMetaAds(storeId, days));
  if (source === "all" || source === "fees") {
    tasks.push(() => reconcileProcessorFees(storeId, days));
  }

  const messages: string[] = [];
  const errors: string[] = [];
  for (const task of tasks) {
    try {
      messages.push((await task()).message);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  revalidatePath("/dashboard", "layout");
  if (errors.length && !messages.length) return { ok: false, message: errors.join(" | ") };
  return {
    ok: errors.length === 0,
    message: [...messages, ...errors].join(" | "),
  };
}

export async function resnapshotCosts(storeId: string): Promise<ActionState> {
  const updated = await recalculateCosts(storeId);
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Re-applied costs to ${updated} line items.` };
}

const manualAdSpendSchema = z.object({
  storeId: z.string().min(1),
  date: z.string().min(1),
  platform: z.string().min(1),
  campaignName: z.string().optional(),
  spend: z.coerce.number().min(0),
});

export async function addManualAdSpend(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = manualAdSpendSchema.safeParse({
    storeId: formData.get("storeId"),
    date: formData.get("date"),
    platform: formData.get("platform"),
    campaignName: formData.get("campaignName")?.toString(),
    spend: formData.get("spend"),
  });
  if (!parsed.success) return { ok: false, message: "Enter a date, platform and amount." };

  const { storeId, platform, spend } = parsed.data;
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const campaignName = parsed.data.campaignName?.trim() || "Manual entry";
  const campaignId = `manual:${campaignName}`;

  await prisma.adSpendEntry.upsert({
    where: {
      storeId_date_platform_campaignId: { storeId, date, platform, campaignId },
    },
    create: { storeId, date, platform, campaignId, campaignName, spend },
    update: { spend, campaignName },
  });

  revalidatePath("/dashboard/ads");
  revalidatePath("/dashboard");
  return { ok: true, message: "Ad spend recorded." };
}
