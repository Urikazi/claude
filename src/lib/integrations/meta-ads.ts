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
};

type InsightRow = {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
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
    fields: "campaign_id,campaign_name,spend,impressions,clicks,actions",
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
