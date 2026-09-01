/**
 * Meta Marketing API client.
 *
 * Create a Meta app, add the Marketing API product, and generate a long-lived token with
 * `ads_read`. The ad account id is the `act_...` value from Ads Manager.
 */

/**
 * The Marketing API retires versions on roughly a 90-day window, far faster than the
 * two years Graph API versions get, so this needs checking a few times a year. An
 * expired version does not error loudly — calls quietly fall back to an older one.
 */
export const META_API_VERSION = "v25.0";

export type MetaCredentials = {
  adAccountId: string;
  accessToken: string;
};

export type MetaDailySpend = {
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  /**
   * Purchase value as Meta attributes it. Stored rather than the ROAS ratio Meta also
   * returns, because ratios cannot be added: a day's ROAS is the day's value over the
   * day's spend, not the average of its campaigns'.
   */
  conversionValue: number;
};

type InsightRow = {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
  purchase_roas?: { action_type: string; value: string }[];
};

class MetaError extends Error {
  constructor(message: string) {
    super(`Meta Ads: ${message}`);
  }
}

function normalizeAccountId(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

/// Meta reports several purchase action types; these are the ones that mean a sale.
const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

function purchaseCount(actions?: InsightRow["actions"]): number {
  if (!actions) return 0;
  for (const action of actions) {
    if (PURCHASE_ACTIONS.has(action.action_type)) {
      return Number.parseInt(action.value, 10) || 0;
    }
  }
  return 0;
}

/**
 * The purchase value Meta attributes to the campaign.
 *
 * Taken from `action_values` where present, and otherwise reconstructed from the ROAS
 * Meta reports times the spend — the same quantity, and the only one available when an
 * account returns one field and not the other.
 */
export function purchaseValue(row: InsightRow): number {
  for (const entry of row.action_values ?? []) {
    if (PURCHASE_ACTIONS.has(entry.action_type)) {
      const value = Number.parseFloat(entry.value);
      if (Number.isFinite(value)) return value;
    }
  }
  for (const entry of row.purchase_roas ?? []) {
    if (PURCHASE_ACTIONS.has(entry.action_type)) {
      const roas = Number.parseFloat(entry.value);
      const spend = Number.parseFloat(row.spend ?? "0");
      if (Number.isFinite(roas) && Number.isFinite(spend)) return roas * spend;
    }
  }
  return 0;
}

export async function fetchDailySpend(
  credentials: MetaCredentials,
  since: Date,
  until: Date,
): Promise<MetaDailySpend[]> {
  const account = normalizeAccountId(credentials.adAccountId);
  const params = new URLSearchParams({
    access_token: credentials.accessToken,
    level: "campaign",
    time_increment: "1",
    limit: "500",
    fields:
      "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas",
    time_range: JSON.stringify({
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    }),
  });

  let url: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/${account}/insights?${params}`;
  const rows: MetaDailySpend[] = [];

  for (let page = 0; page < 50 && url; page += 1) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new MetaError(`${response.status} ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      data?: InsightRow[];
      paging?: { next?: string };
      error?: { message: string };
    };
    if (payload.error) throw new MetaError(payload.error.message);

    for (const row of payload.data ?? []) {
      rows.push({
        date: row.date_start,
        campaignId: row.campaign_id ?? "",
        campaignName: row.campaign_name ?? "Unattributed",
        spend: Number.parseFloat(row.spend ?? "0") || 0,
        impressions: Number.parseInt(row.impressions ?? "0", 10) || 0,
        clicks: Number.parseInt(row.clicks ?? "0", 10) || 0,
        conversions: purchaseCount(row.actions),
        conversionValue: purchaseValue(row),
      });
    }

    url = payload.paging?.next ?? null;
  }

  return rows;
}

export async function verifyCredentials(credentials: MetaCredentials) {
  const account = normalizeAccountId(credentials.adAccountId);
  const params = new URLSearchParams({
    access_token: credentials.accessToken,
    fields: "name,currency,account_status",
  });
  const response = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${account}?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new MetaError(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as {
    name: string;
    currency: string;
    account_status: number;
  };
}
