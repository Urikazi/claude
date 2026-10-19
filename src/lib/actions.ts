"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertSession } from "@/lib/session";
import { ACTIVE_STORE_COOKIE } from "@/lib/store";
import { DEFAULT_FEE_CONFIG } from "@/lib/fees";
import { parseSpendPaste } from "@/lib/ad-spend-paste";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/timezone";
import { parsePriceList, priceListToRows, withCountryFallback } from "@/lib/price-list";
import { parseCogsCsv, CogsCsvError } from "@/lib/supplier-cogs-csv";
import * as metaAds from "@/lib/integrations/meta-ads";
import {
  clearAdvisorApiKey,
  describeApiKeyProblem,
  setAdvisorApiKey,
} from "@/lib/advisor/api-key";
import { findAdvisorModel, setAdvisorModel } from "@/lib/advisor/models";
import { findBundledPriceList } from "@/lib/bundled-price-lists";
// Bundled at build time rather than read from disk, so it survives deployment to a
// host that only ships the compiled output.
import { ANY_COUNTRY, resolveTierSku } from "@/lib/cost-tiers";
import { auditInvoice, parseInvoice, InvoiceFormatError } from "@/lib/invoice-audit";
import { CHANGE_CATEGORIES } from "@/lib/change-categories";
import {
  applyCostTiers,
  recalculateCosts,
  recalculateFees,
  reconcileProcessorFees,
  loadTierTable,
  syncMetaAds,
  syncShopifySessions,
  syncShopifyOrders,
  syncShopifyProducts,
  NotConfiguredError,
} from "@/lib/sync";

export type ActionState = { ok: boolean; message: string } | null;

const credentialsSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().min(1).max(3),
  timezone: z.string().min(1),
  shopifyDomain: z.string().optional(),
  shopifyClientId: z.string().optional(),
  shopifyClientSecret: z.string().optional(),
  shopifyAccessToken: z.string().optional(),
  stripeSecretKey: z.string().optional(),
  paypalClientId: z.string().optional(),
  paypalClientSecret: z.string().optional(),
  paypalLiveMode: z.boolean(),
  metaReportsNewCustomersOnly: z.boolean(),
});

/// A blank secret field means "leave the stored value alone", not "clear it".
function keepIfBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The Meta ad accounts submitted with the settings form.
 *
 * The list is read back whole rather than diffed field by field: rows arrive indexed
 * (`metaAccount.0.accountId`), an existing row carries its id in a hidden field, and a
 * row the browser did not send is one the user removed. That makes removal fall out of
 * the same save as an edit, with no separate delete round trip to get out of step with.
 */
type SubmittedMetaAccount = {
  id: string;
  accountId: string;
  label: string;
  token: string;
  active: boolean;
};

function readMetaAccounts(formData: FormData): SubmittedMetaAccount[] {
  const rows = new Map<string, Partial<SubmittedMetaAccount>>();
  for (const [key, value] of formData.entries()) {
    const match = /^metaAccount\.(\d+)\.(id|accountId|label|token|active)$/.exec(key);
    if (!match) continue;
    const index = match[1];
    const field = match[2] as "id" | "accountId" | "label" | "token" | "active";
    const row = rows.get(index) ?? {};
    if (field === "active") row.active = value.toString() === "on";
    else row[field] = value.toString().trim();
    rows.set(index, row);
  }

  return [...rows.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, row]) => ({
      id: row.id ?? "",
      accountId: row.accountId ?? "",
      label: row.label ?? "",
      token: row.token ?? "",
      // A checkbox sends nothing when unticked, so its absence is the "off" signal.
      active: row.active ?? false,
    }))
    // A blank row is the empty one left at the bottom of the form, not a request to
    // save an account with no credentials.
    .filter((row) => row.accountId || row.token || row.label || row.id);
}

/**
 * A Meta app secret is 32 hex characters and an access token is not, so the easy
 * paste-the-wrong-value mistake can be named here rather than surfacing days later as
 * an opaque OAuthException mid-sync.
 */
function describeMetaTokenProblem(token: string): string | null {
  if (!token) return null;
  if (/^[0-9a-f]{32}$/i.test(token)) {
    return "That looks like your Meta app secret, not an access token. Generate a long-lived token with the ads_read permission instead.";
  }
  if (token.length < 40) {
    return "That does not look like a Meta access token — they are much longer. Copy the whole value.";
  }
  return null;
}

/**
 * Writes the submitted account list over the stored one.
 *
 * Returns a message on refusal and null on success. Nothing is written until every
 * row passes, so a typo in the third account cannot half-apply the first two.
 */
async function saveMetaAccounts(
  storeId: string,
  submitted: SubmittedMetaAccount[],
): Promise<string | null> {
  const existing = await prisma.metaAdAccount.findMany({ where: { storeId } });
  const byId = new Map(existing.map((account) => [account.id, account]));

  const resolved: {
    id: string | null;
    accountId: string;
    accessToken: string;
    label: string | null;
    active: boolean;
    position: number;
  }[] = [];

  for (const [position, row] of submitted.entries()) {
    const stored = row.id ? byId.get(row.id) : undefined;
    if (row.id && !stored) {
      return "One of those ad accounts no longer exists. Reload the page and try again.";
    }

    const accountId = metaAds.normalizeAccountId(row.accountId);
    if (!/^act_\d+$/.test(accountId)) {
      return `"${row.accountId || "(blank)"}" is not an ad account id. Copy the act_... value from Ads Manager.`;
    }

    const tokenProblem = describeMetaTokenProblem(row.token);
    if (tokenProblem) return tokenProblem;

    // Blank means "leave the stored token alone" on an existing row, the same as every
    // other secret on this page. On a new row there is nothing to leave alone.
    const accessToken = row.token || stored?.accessToken;
    if (!accessToken) {
      return `${row.label || accountId} needs an access token.`;
    }

    if (resolved.some((other) => other.accountId === accountId)) {
      return `${accountId} is listed twice. Each ad account can only be connected once.`;
    }

    resolved.push({
      id: stored?.id ?? null,
      accountId,
      accessToken,
      label: row.label || null,
      active: row.active,
      position,
    });
  }

  const keptIds = new Set(resolved.map((row) => row.id).filter(Boolean) as string[]);
  await prisma.$transaction([
    prisma.metaAdAccount.deleteMany({
      where: { storeId, id: { notIn: [...keptIds] } },
    }),
    ...resolved.map(({ id, ...data }) =>
      id
        ? prisma.metaAdAccount.update({ where: { id }, data })
        : prisma.metaAdAccount.create({ data: { ...data, storeId } }),
    ),
  ]);
  return null;
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
    stripeSecretKey: formData.get("stripeSecretKey")?.toString(),
    paypalClientId: formData.get("paypalClientId")?.toString(),
    paypalClientSecret: formData.get("paypalClientSecret")?.toString(),
    paypalLiveMode: formData.get("paypalLiveMode") === "on",
    metaReportsNewCustomersOnly:
      formData.get("metaReportsNewCustomersOnly") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Check the store name and currency." };

  const data = parsed.data;

  const tokenError = describeShopifyTokenProblem(keepIfBlank(data.shopifyAccessToken));
  if (tokenError) return { ok: false, message: tokenError };

  // Before the store row, so a rejected ad account leaves the whole form unsaved
  // rather than quietly keeping the other fields and dropping the accounts.
  const metaError = await saveMetaAccounts(data.storeId, readMetaAccounts(formData));
  if (metaError) return { ok: false, message: metaError };

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
      stripeSecretKey: keepIfBlank(data.stripeSecretKey),
      paypalClientId: keepIfBlank(data.paypalClientId),
      paypalClientSecret: keepIfBlank(data.paypalClientSecret),
      paypalLiveMode: data.paypalLiveMode,
      metaReportsNewCustomersOnly: data.metaReportsNewCustomersOnly,
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
  source:
    | "shopify-products"
    | "shopify-orders"
    | "shopify-sessions"
    | "meta"
    | "fees"
    | "all",
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
  if (source === "all" || source === "shopify-sessions") {
    tasks.push(() => syncShopifySessions(storeId, days));
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

  // An order to a country the quote skips would otherwise cost nothing at all, so the
  // US price stands in. See withCountryFallback for why that is the lesser error.
  const { list, applied } = withCountryFallback(parsed.list);
  const rows = priceListToRows(list);

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

  const skus = list.products.length;
  const fallback = applied.length
    ? ` Destinations the quote skips are costed at the US price for ${applied.join(", ")}.`
    : "";
  return {
    ok: true,
    message: `Imported ${rows.length} prices across ${skus} products. Repriced ${priced} order lines.${fallback}`,
  };
}

/** Supplier sheets run to a few hundred rows; past this it is not one of them. */
const MAX_COGS_CSV_BYTES = 2_000_000;

/**
 * Imports the supplier's own COGS sheet.
 *
 * Unlike the JSON import this merges by SKU rather than replacing the list: a quote
 * usually covers one product, and wiping the add-ons because the serum was requoted
 * would silently drop them back to costing nothing. SKUs in the file are replaced
 * whole — a new quote supersedes the old one for that product, destination for
 * destination — and SKUs absent from it are left alone.
 */
export async function importCogsCsv(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const storeId = formData.get("storeId")?.toString();
  if (!storeId) return { ok: false, message: "Missing store." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a CSV exported from the supplier's COGS sheet." };
  }
  if (file.size > MAX_COGS_CSV_BYTES) {
    return { ok: false, message: "That file is too large to be a COGS sheet." };
  }

  let report;
  try {
    report = parseCogsCsv(await file.text());
  } catch (error) {
    if (error instanceof CogsCsvError) return { ok: false, message: error.message };
    throw error;
  }

  const { list, applied } = withCountryFallback(report.list);
  const rows = priceListToRows(list);
  const skus = list.products.map((product) => product.sku);
  await prisma.$transaction([
    prisma.supplierCostTier.deleteMany({ where: { storeId, sku: { in: skus } } }),
    prisma.supplierCostTier.createMany({ data: rows.map((row) => ({ storeId, ...row })) }),
  ]);
  const priced = await applyCostTiers(storeId);

  /**
   * Which SKUs the store actually sells that nothing now prices.
   *
   * A sheet can import cleanly and still leave the main product costing nothing: the
   * supplier quotes Veyla's serum as FL2601612 while the orders carry FL2601024, so a
   * CSV naming only the quoted code reports hundreds of prices and reprices almost
   * nothing. Checking what the orders use against what is priced turns that from a
   * silent success into a named gap.
   */
  const sold = await prisma.orderLineItem.findMany({
    where: { order: { storeId }, sku: { not: null } },
    distinct: ["sku"],
    select: { sku: true },
  });
  const pricedSkus = new Set(
    (
      await prisma.supplierCostTier.findMany({
        where: { storeId },
        distinct: ["sku"],
        select: { sku: true },
      })
    ).map((row) => row.sku),
  );
  const unmatched = sold
    .map((row) => row.sku!)
    .filter((sku) => !resolveTierSku(pricedSkus, sku))
    .sort();

  revalidatePath("/dashboard", "layout");

  const { products, destinations, prices } = report.counts;
  const parts = [
    `Imported ${prices} prices for ${products} ${products === 1 ? "product" : "products"} across ${destinations} SKU-destination pairs. Repriced ${priced} order lines.`,
  ];
  // Named first: an unpriced SKU the store sells costs the whole of its fulfilment,
  // which dwarfs every other note here.
  if (unmatched.length) {
    parts.push(
      `Still costing nothing, because your orders use ${unmatched.join(", ")} and no loaded sheet prices ${unmatched.length === 1 ? "it" : "them"} — check whether your supplier quotes the same product under a different code.`,
    );
  }
  if (applied.length) {
    parts.push(
      `Destinations the sheet skips are costed at the US price for ${applied.join(", ")} — better than costing nothing, but the US is cheap, so those read low.`,
    );
  }
  if (report.renamed.length) {
    parts.push(
      `Stored ${report.renamed.map((r) => `${r.from} as ${r.to}`).join(", ")}, which matches either spelling.`,
    );
  }
  if (report.noShipping.length) {
    parts.push(`Skipped ${report.noShipping.length} not-shippable: ${report.noShipping.join(", ")}.`);
  }
  if (report.unpriced.length) {
    parts.push(`Priced nowhere on the sheet: ${report.unpriced.join(", ")}.`);
  }
  if (report.gapped.length) {
    parts.push(
      `Quoted with a gap, so those quantities interpolate: ${report.gapped
        .map((g) => `${g.country} (no ${g.missing.join(", ")})`)
        .join(", ")}.`,
    );
  }
  // Worth saying out loud: a total that falls as quantity rises is a sheet error, and it
  // is loaded as quoted because the supplier bills from the same sheet.
  if (report.anomalies.length) {
    parts.push(
      `Check these with your supplier — the price drops as quantity rises: ${report.anomalies
        .map((a) => `${a.country} ${a.from}u $${a.was.toFixed(2)} but ${a.to}u $${a.now.toFixed(2)}`)
        .join("; ")}.`,
    );
  }
  return { ok: true, message: parts.join(" ") };
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
 * Imports one of the price lists that ship with the app. Copying a JSON file out of the
 * repository and pasting it into a textarea is a lot of ceremony for the one action that
 * makes profit numbers real, and it is where setup stalls.
 */
export async function importBundledPriceList(
  storeId: string,
  key: string,
): Promise<ActionState> {
  await assertSession();
  const bundled = findBundledPriceList(key);
  if (!bundled) return { ok: false, message: "That price list is not one of the bundled ones." };
  return applyPriceList(storeId, JSON.stringify(bundled.list));
}

const changeSchema = z.object({
  storeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(120),
  category: z.enum(CHANGE_CATEGORIES.map((c) => c.value) as [string, ...string[]]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Saves the Claude API key both advisors use.
 *
 * Blank leaves the stored key alone, like every other secret on the settings page;
 * removing one is its own explicit action rather than something an empty field does
 * by accident.
 */
export async function updateAdvisorApiKey(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();

  if (formData.get("remove") === "on") {
    await clearAdvisorApiKey();
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/advisor");
    return { ok: true, message: "Key removed. Both advisors are switched off until another is set." };
  }

  const key = formData.get("anthropicApiKey")?.toString().trim();
  if (!key) return { ok: false, message: "Paste a key, or tick remove to delete the stored one." };

  const problem = describeApiKeyProblem(key);
  if (problem) return { ok: false, message: problem };

  await setAdvisorApiKey(key);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/advisor");
  return {
    ok: true,
    message:
      "Key saved. It is stored in your database in plain text, like the other provider credentials here — so treat your DATABASE_URL as being as sensitive as the key.",
  };
}

/** Chooses the model both advisors run on. One choice for the whole dashboard. */
export async function updateAdvisorModel(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const id = formData.get("model")?.toString() ?? "";
  if (!(await setAdvisorModel(id))) {
    return { ok: false, message: "That is not one of the available models." };
  }
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/advisor", "layout");
  return { ok: true, message: `Now using ${findAdvisorModel(id)?.label ?? id}.` };
}

/** Wipes one advisor's thread for one store. The other advisor's is untouched. */
export async function clearAdvisorThread(
  storeId: string,
  agent: string,
): Promise<ActionState> {
  await assertSession();
  await prisma.advisorMessage.deleteMany({ where: { storeId, agent } });
  revalidatePath("/dashboard/advisor", "layout");
  return { ok: true, message: "Conversation cleared." };
}

export async function logStoreChange(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const parsed = changeSchema.safeParse({
    storeId: formData.get("storeId"),
    date: formData.get("date"),
    title: formData.get("title"),
    category: formData.get("category") ?? "other",
    note: formData.get("note")?.toString() || undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: "Give the change a date and a short title." };
  }

  const { storeId, title, category, note } = parsed.data;
  await prisma.storeChange.create({
    data: {
      storeId,
      // Dated at UTC midnight of the chosen day, matching ad spend and traffic.
      date: new Date(`${parsed.data.date}T00:00:00.000Z`),
      title,
      category,
      note: note ?? null,
    },
  });

  revalidatePath("/dashboard/conversion");
  return { ok: true, message: "Change logged." };
}

export async function deleteStoreChange(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const id = formData.get("id")?.toString();
  if (!id) return { ok: false, message: "Missing change." };
  await prisma.storeChange.delete({ where: { id } }).catch(() => null);
  revalidatePath("/dashboard/conversion");
  return { ok: true, message: "Change removed." };
}

/**
 * Checks a supplier's daily invoice against the agreed price list and keeps the result.
 *
 * The file is read here rather than in the browser so the price list never leaves the
 * server, and so the check cannot be talked out of a verdict by whatever the page was
 * showing at the time.
 */
export async function auditSupplierInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const storeId = formData.get("storeId")?.toString();
  const file = formData.get("invoice");
  if (!storeId) return { ok: false, message: "Missing store." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose the invoice file your supplier sent." };
  }
  if (file.size > 8_000_000) {
    return { ok: false, message: "That file is over 8 MB. Upload a single day's invoice." };
  }

  let audit;
  try {
    audit = auditInvoice(await loadTierTable(storeId), parseInvoice(await file.text()));
  } catch (error) {
    if (error instanceof InvoiceFormatError) return { ok: false, message: error.message };
    throw error;
  }

  if (!audit.lines.length) {
    return { ok: false, message: "No billed lines found in that file." };
  }

  const dates = audit.lines.map((line) => line.date).filter(Boolean).sort();
  const invoiceDate = dates.length ? new Date(`${dates[0]}T00:00:00.000Z`) : null;

  await prisma.supplierInvoice.create({
    data: {
      storeId,
      filename: file.name || "invoice.csv",
      invoiceDate,
      lineCount: audit.lines.length,
      billedLines: audit.billedLines,
      totalCharged: audit.totalCharged,
      totalExpected: audit.totalExpected,
      variance: audit.variance,
      overchargedCount: audit.overcharged.length,
      underchargedCount: audit.undercharged.length,
      unquotedCount: audit.noCountryQuote.length + audit.unpriced.length,
      statedTotal: audit.statedTotal,
      lineSum: audit.lineSum,
      lines: {
        createMany: {
          data: audit.lines.map((line) => ({
            orderRef: line.orderRef,
            date: line.date,
            country: line.country,
            product: line.product,
            sku: line.billedSku,
            quantity: line.billedQuantity,
            charged: line.charged,
            expected: line.expected,
            variance: line.variance,
            verdict: line.verdict,
          })),
        },
      },
    },
  });

  revalidatePath("/dashboard/invoices");
  const summary =
    audit.overcharged.length > 0
      ? `Checked ${audit.billedLines} billed lines — ${audit.overcharged.length} charged above the price list, ${formatVariance(audit.variance)} in total.`
      : `Checked ${audit.billedLines} billed lines — every one matches the price list.`;
  return { ok: true, message: summary };
}

const formatVariance = (value: number) =>
  `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;

export async function deleteSupplierInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const id = formData.get("id")?.toString();
  if (!id) return { ok: false, message: "Missing invoice." };
  await prisma.supplierInvoice.delete({ where: { id } }).catch(() => null);
  revalidatePath("/dashboard/invoices");
  return { ok: true, message: "Invoice removed." };
}

/**
 * Switches which store the dashboard shows.
 *
 * Every report already scopes its queries by store, so the selection is the only thing
 * that has to move; the cookie is read on the server so a switch lands before anything
 * renders rather than flashing the previous store's figures.
 */
export async function selectStore(storeId: string): Promise<ActionState> {
  await assertSession();
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true },
  });
  if (!store) return { ok: false, message: "That store no longer exists." };

  (await cookies()).set(ACTIVE_STORE_COOKIE, store.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Showing ${store.name}.` };
}

export async function createStore(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertSession();
  const name = formData.get("name")?.toString().trim();
  if (!name) return { ok: false, message: "Give the store a name." };
  if (name.length > 80) return { ok: false, message: "That name is too long." };

  const currency = formData.get("currency")?.toString().trim().toUpperCase() || "USD";
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, message: "Currency must be a three-letter code, such as USD." };
  }

  const store = await prisma.store.create({
    data: { name, currency, feeConfig: { create: DEFAULT_FEE_CONFIG } },
  });

  // Switched to immediately: the next thing anyone does with a new store is set it up.
  await selectStore(store.id);
  revalidatePath("/dashboard", "layout");
  return {
    ok: true,
    message: `${name} added. Connect it in settings, then sync.`,
  };
}
