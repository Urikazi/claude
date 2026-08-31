"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertSession } from "@/lib/session";
import { DEFAULT_FEE_CONFIG } from "@/lib/fees";
import { parseSpendPaste } from "@/lib/ad-spend-paste";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/timezone";
import { parsePriceList, priceListToRows } from "@/lib/price-list";
// Bundled at build time rather than read from disk, so it survives deployment to a
// host that only ships the compiled output.
import bundledPriceList from "../../data/derma-muse-price-list.json";
import { ANY_COUNTRY } from "@/lib/cost-tiers";
import {
  applyCostTiers,
  recalculateCosts,
  recalculateFees,
  reconcileProcessorFees,
  syncMetaAds,
  syncShopifyOrders,
  syncShopifyProducts,
  NotConfiguredError,
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
  await assertSession();
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
  timezone: z.string().min(1),
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
  await assertSession();
  const parsed = credentialsSchema.safeParse({
    storeId: formData.get("storeId"),
    name: formData.get("name"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone") ?? "UTC",
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
      // Rejected rather than stored blindly: an unknown zone would silently move
      // every day boundary back to UTC.
      timezone: isValidTimeZone(data.timezone) ? data.timezone : DEFAULT_TIME_ZONE,
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
  await assertSession();
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
  full = false,
): Promise<ActionState> {
  await assertSession();
  const tasks: (() => Promise<{ message: string }>)[] = [];
  if (source === "all" || source === "shopify-products") {
    tasks.push(() => syncShopifyProducts(storeId));
  }
  if (source === "all" || source === "shopify-orders") {
    tasks.push(() => syncShopifyOrders(storeId, days, full));
  }
  if (source === "all" || source === "meta") tasks.push(() => syncMetaAds(storeId, days));
  if (source === "all" || source === "fees") {
    tasks.push(() => reconcileProcessorFees(storeId, days));
  }

  const messages: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const task of tasks) {
    try {
      messages.push((await task()).message);
    } catch (error) {
      if (error instanceof NotConfiguredError) skipped.push(error.message);
      else errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  revalidatePath("/dashboard", "layout");

  // Only a real failure is a failure. Syncing what is connected and skipping what
  // is not is the normal state of a dashboard being filled in one source at a time.
  const parts = [...messages, ...errors];
  if (skipped.length) {
    parts.push(`Not set up yet: ${[...new Set(skipped)].join(", ")}.`);
  }
  if (!messages.length && !errors.length && skipped.length) {
    return { ok: false, message: `Nothing to sync. Not set up yet: ${[...new Set(skipped)].join(", ")}.` };
  }
  return { ok: errors.length === 0, message: parts.join(" | ") };
}

export async function resnapshotCosts(storeId: string): Promise<ActionState> {
  await assertSession();
  const updated = await recalculateCosts(storeId);
  const tiered = await applyCostTiers(storeId);
  revalidatePath("/dashboard", "layout");
  return {
    ok: true,
    message: `Re-applied costs to ${updated} line items` +
      (tiered ? `, ${tiered} priced from the supplier list.` : "."),
  };
}

export async function importPriceList(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const storeId = formData.get("storeId")?.toString();
  if (!storeId) return { ok: false, message: "Missing store." };
  return applyPriceList(storeId, formData.get("priceList")?.toString() ?? "");
}

async function applyPriceList(storeId: string, raw: string): Promise<ActionState> {
  const parsed = parsePriceList(raw);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const rows = priceListToRows(parsed.list);

  // Replace rather than merge: a new quote supersedes the old one, and leaving
  // stale tiers behind would silently price some orders off last quarter's sheet.
  await prisma.$transaction([
    prisma.supplierCostTier.deleteMany({ where: { storeId } }),
    prisma.supplierCostTier.createMany({
      data: rows.map((row) => ({ storeId, ...row })),
    }),
  ]);

  const priced = await applyCostTiers(storeId);
  revalidatePath("/dashboard", "layout");

  const skus = parsed.list.products.length;
  return {
    ok: true,
    message: `Imported ${rows.length} prices across ${skus} products. Repriced ${priced} order lines.`,
  };
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
  await assertSession();
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

const PLATFORMS = ["meta", "tiktok", "google", "other"] as const;

/**
 * Bulk entry for ad spend copied out of an ads platform. One row per day; pasting
 * the same range again overwrites those days rather than double-counting them, so a
 * correction is just another paste.
 */
export async function importAdSpendPaste(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const storeId = formData.get("storeId")?.toString();
  if (!storeId) return { ok: false, message: "Missing store." };

  const platform = formData.get("platform")?.toString() ?? "meta";
  if (!PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    return { ok: false, message: "Unknown platform." };
  }

  const { rows, skipped } = parseSpendPaste(formData.get("rows")?.toString() ?? "");
  if (rows.length === 0) {
    return {
      ok: false,
      message:
        "No rows recognised. Each line needs a date and an amount, for example: 2026-08-01<tab>124.53",
    };
  }

  // Several campaigns can report on the same day; sum them into one figure per day.
  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.spend);
  }

  const campaignId = "manual:pasted";
  await prisma.$transaction(
    [...byDate.entries()].map(([date, spend]) =>
      prisma.adSpendEntry.upsert({
        where: {
          storeId_date_platform_campaignId: {
            storeId,
            date: new Date(`${date}T00:00:00.000Z`),
            platform,
            campaignId,
          },
        },
        create: {
          storeId,
          date: new Date(`${date}T00:00:00.000Z`),
          platform,
          campaignId,
          campaignName: "Pasted",
          spend,
        },
        update: { spend },
      }),
    ),
  );

  revalidatePath("/dashboard/ads");
  revalidatePath("/dashboard");

  const dates = [...byDate.keys()].sort();
  const total = [...byDate.values()].reduce((sum, value) => sum + value, 0);
  return {
    ok: true,
    message:
      `Imported ${byDate.size} days (${dates[0]} to ${dates[dates.length - 1]}), ` +
      `${total.toFixed(2)} total.` +
      (skipped.length ? ` Skipped ${skipped.length} unreadable line(s): ${skipped.slice(0, 5).join(", ")}.` : ""),
  };
}

/**
 * Manual entries exist because the API was not connected yet. Once a platform syncs
 * the same day, both rows are counted and the day's spend doubles — silently, and in
 * the direction that understates profit.
 *
 * Only days the platform itself has now reported are cleared, and only for that
 * platform, so hand-entered spend for channels with no integration is untouched.
 */
export async function removeSupersededManualSpend(
  storeId: string,
  platform = "meta",
): Promise<ActionState> {
  await assertSession();

  const synced = await prisma.adSpendEntry.findMany({
    where: { storeId, platform, NOT: { campaignId: { startsWith: "manual:" } } },
    select: { date: true },
    distinct: ["date"],
  });
  if (synced.length === 0) {
    return {
      ok: false,
      message: `No synced ${platform} data yet, so nothing has been superseded. Run a sync first.`,
    };
  }

  const { count } = await prisma.adSpendEntry.deleteMany({
    where: {
      storeId,
      platform,
      campaignId: { startsWith: "manual:" },
      date: { in: synced.map((row) => row.date) },
    },
  });

  revalidatePath("/dashboard/ads");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: count
      ? `Removed ${count} manual entr${count === 1 ? "y" : "ies"} on days now covered by ${platform}.`
      : "Nothing to remove — no manual entries overlap the synced days.",
  };
}

/**
 * Per-unit cost plus bundle prices for a SKU.
 *
 * A fulfilment quote gives one price for a single item and a cheaper total for
 * several, because the parcel ships once. Quantity 1 is the unit cost; every other
 * quantity is a bundle holding the total for that many units, not a per-unit rate.
 *
 * Quantities are whatever the supplier quoted rather than a fixed set of slots — some
 * products are priced in threes, some to six, some only singly.
 */
export async function updateVariantCosting(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const storeId = formData.get("storeId")?.toString();
  const sku = formData.get("sku")?.toString()?.trim();
  if (!storeId) return { ok: false, message: "Missing store." };
  if (!sku) {
    return { ok: false, message: "This variant has no SKU, so costs cannot be matched to its orders." };
  }

  const readAmount = (value: FormDataEntryValue | null): number | null => {
    const raw = value?.toString().trim();
    if (!raw) return null;
    const amount = Number(raw);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  };

  const tiers = new Map<number, number>();

  const unitRaw = formData.get("costPerUnit")?.toString().trim();
  if (unitRaw) {
    const unit = readAmount(unitRaw);
    if (unit === null) return { ok: false, message: "Cost per unit must be a positive number." };
    if (unit > 0) tiers.set(1, unit);
  }

  const quantities = formData.getAll("bundleQuantity");
  const totals = formData.getAll("bundleCost");
  for (let i = 0; i < quantities.length; i += 1) {
    const quantity = Number(quantities[i]?.toString().trim());
    const total = readAmount(totals[i] ?? null);
    // A row the user started and left blank is skipped rather than rejected.
    if (!Number.isInteger(quantity) || quantity < 2) {
      if (total === null) continue;
      return { ok: false, message: "Bundle quantities must be whole numbers of 2 or more." };
    }
    if (total === null) continue;
    tiers.set(quantity, total);
  }

  await prisma.$transaction([
    prisma.supplierCostTier.deleteMany({ where: { storeId, sku, country: ANY_COUNTRY } }),
    ...(tiers.size
      ? [
          prisma.supplierCostTier.createMany({
            data: [...tiers.entries()].map(([quantity, totalCost]) => ({
              storeId,
              sku,
              country: ANY_COUNTRY,
              quantity,
              totalCost,
            })),
          }),
        ]
      : []),
  ]);

  const priced = await applyCostTiers(storeId);
  revalidatePath("/dashboard/products");
  revalidatePath("/dashboard");

  const bundles = tiers.size - (tiers.has(1) ? 1 : 0);
  return {
    ok: true,
    message: tiers.size
      ? `Saved${tiers.has(1) ? " unit cost" : ""}${bundles ? ` and ${bundles} bundle${bundles === 1 ? "" : "s"}` : ""}. Repriced ${priced} order lines.`
      : `Cleared costs for ${sku}.`,
  };
}

/**
 * Imports the price list that ships with the app. Copying a JSON file out of the
 * repository and pasting it into a textarea is a lot of ceremony for the one action
 * that makes profit numbers real, and it is where setup stalls.
 */
export async function importBundledPriceList(storeId: string): Promise<ActionState> {
  await assertSession();
  return applyPriceList(storeId, JSON.stringify(bundledPriceList));
}
