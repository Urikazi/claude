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
export const META_API_VERSION = "v26.0";

export type MetaCredentials = {
  adAccountId: string;
  accessToken: string;
};

export type MetaDailySpend = {
  date: string; // YYYY-MM-DD
  /// The `act_...` account this row was billed to.
  adAccountId: string;
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

/**
 * What Meta said, turned into what to do about it.
 *
 * Graph errors arrive as a wall of JSON that a sync panel truncates mid-token, so the
 * one useful part — which of several unrelated problems this is — is the part that
 * gets cut off. Each case below names the screen that fixes it, because the codes
 * overlap: a permission error is as likely to be an unassigned asset as a missing
 * scope, and the two are fixed in different places.
 *
 * Anything unrecognised is passed through whole rather than guessed at.
 */
export function explainMetaError(status: number, body: string): string {
  let error: { message?: string; code?: number; error_subcode?: number; type?: string } = {};
  try {
    error = (JSON.parse(body) as { error?: typeof error }).error ?? {};
  } catch {
    return `${status} ${body}`.slice(0, 300);
  }

  const message = error.message ?? `HTTP ${status}`;
  const code = error.code;

  // Meta returns this when the app itself may not call the Marketing API, before it
  // looks at the account. Nothing about the token or the account id will change it.
  if (/api access blocked/i.test(message)) {
    return `${message} Your Meta app is not allowed to call the Marketing API — this is set on the app, not on the ad account or the token. Check App Dashboard → Marketing API → Settings for the access level, and Business Settings → Security Centre for business verification.`;
  }

  if (code === 190) {
    return `${message} The access token is expired or revoked. Generate a new one under Business Settings → System users and paste it in again.`;
  }

  if (code === 200 || code === 10 || code === 299) {
    return `${message} The token is missing the ads_read permission, or this ad account is not assigned to the system user. Business Settings → System users → Add assets → Ad accounts, with View performance.`;
  }

  if (code === 100) {
    return `${message} Check the ad account id — it is the act_... value from Ads Manager.`;
  }

  // Throttling is the one case that fixes itself, so say so rather than sending
  // someone to a settings screen that is already correct.
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return `${message} Meta is rate limiting this account. The next sync should go through.`;
  }

  if (code === 2635 || /deprecat/i.test(message)) {
    return `${message} This Marketing API version has been retired — META_API_VERSION needs raising.`;
  }

  return `${status} ${message}`;
}

export function normalizeAccountId(id: string): string {
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

/**
 * One raw insights row, exactly as Meta sends it.
 *
 * For the case where rows come back and every one of them reads as zero spend. That
 * can be an idle account or a field this client is misreading, and no amount of
 * reasoning from the parsed figures distinguishes them — the answer is in what the
 * API actually returned, so it is fetched and shown rather than guessed at.
 *
 * Insights rows carry campaign performance and no credentials: the token travels in
 * the request, never the response.
 */
/**
 * One raw insights row, exactly as Meta sends it.
 *
 * Shown when an account reads as zero spend, because the parsed figures cannot tell an
 * idle account apart from one whose cost columns Meta is withholding. The answer is in
 * the payload itself. Insights rows carry campaign performance and no credentials: the
 * token travels in the request, never the response.
 */
export async function fetchInsightsSample(
  credentials: MetaCredentials,
  since: Date,
  until: Date,
): Promise<Record<string, unknown> | null> {
  const account = normalizeAccountId(credentials.adAccountId);
  const params = new URLSearchParams({
    access_token: credentials.accessToken,
    level: "campaign",
    time_increment: "1",
    limit: "3",
    fields:
      "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas",
    time_range: JSON.stringify({
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    }),
  });
  const response = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${account}/insights?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as { data?: Record<string, unknown>[] };
  return payload.data?.[0] ?? null;
}

type InsightsLevel = "campaign" | "account";

/**
 * One page-walked insights query.
 *
 * Split out of `fetchDailySpend` because the same days have to be asked for twice at
 * different breakdowns: Meta will hand back a campaign split whose cost columns are all
 * zero and an account-level total for those same days that is not.
 */
async function requestInsights(
  credentials: MetaCredentials,
  level: InsightsLevel,
  since: Date,
  until: Date,
): Promise<InsightRow[]> {
  const account = normalizeAccountId(credentials.adAccountId);
  const params = new URLSearchParams({
    access_token: credentials.accessToken,
    level,
    time_increment: "1",
    limit: "500",
    fields:
      level === "campaign"
        ? "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas"
        : "spend,impressions,clicks,actions,action_values,purchase_roas",
    time_range: JSON.stringify({
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    }),
  });

  let url: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/${account}/insights?${params}`;
  const rows: InsightRow[] = [];

  for (let page = 0; page < 50 && url; page += 1) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new MetaError(explainMetaError(response.status, await response.text()));
    }
    const payload = (await response.json()) as {
      data?: InsightRow[];
      paging?: { next?: string };
      error?: { message: string };
    };
    if (payload.error) throw new MetaError(payload.error.message);
    rows.push(...(payload.data ?? []));
    url = payload.paging?.next ?? null;
  }

  return rows;
}

function toDailySpend(
  rows: InsightRow[],
  account: string,
  fallbackName: string,
): MetaDailySpend[] {
  return rows.map((row) => ({
    date: row.date_start,
    adAccountId: account,
    /**
     * Meta campaign ids are unique across accounts, so they key a day's spend on their
     * own. A row that arrives without one is the exception, and falling back to a bare
     * "" would let two accounts' unattributed spend for the same day overwrite each
     * other — the account id keeps them apart.
     */
    campaignId: row.campaign_id ?? `${account}:unattributed`,
    campaignName: row.campaign_name ?? fallbackName,
    spend: Number.parseFloat(row.spend ?? "0") || 0,
    impressions: Number.parseInt(row.impressions ?? "0", 10) || 0,
    clicks: Number.parseInt(row.clicks ?? "0", 10) || 0,
    conversions: purchaseCount(row.actions),
    conversionValue: purchaseValue(row),
  }));
}

function sumSpend(rows: MetaDailySpend[]): number {
  return rows.reduce((sum, row) => sum + row.spend, 0);
}

/**
 * A day of spend per campaign, or per account when Meta will not break it down.
 *
 * Some tokens get a campaign split in which `spend`, `impressions` and `clicks` all read
 * "0" while the `actions` on that same row report hundreds of link clicks — figures that
 * cannot both be true, since link clicks are a subset of clicks. Meta is withholding the
 * cost columns at that breakdown rather than describing an idle account, and asking for
 * the same days without the campaign split often returns them. A P&L needs the spend far
 * more than it needs the campaign split, so take the coarser answer when the detailed one
 * comes back empty-handed.
 */
export async function fetchDailySpend(
  credentials: MetaCredentials,
  since: Date,
  until: Date,
): Promise<MetaDailySpend[]> {
  const account = normalizeAccountId(credentials.adAccountId);
  const byCampaign = toDailySpend(
    await requestInsights(credentials, "campaign", since, until),
    account,
    "Unattributed",
  );
  if (sumSpend(byCampaign) > 0) return byCampaign;

  const byAccount = toDailySpend(
    await requestInsights(credentials, "account", since, until),
    account,
    "All campaigns",
  );
  // Only prefer the coarser answer where it carries the figure the detailed one was
  // missing. Otherwise the account genuinely did not spend, and the campaign rows are the
  // better record of what existed.
  return sumSpend(byAccount) > 0 ? byAccount : byCampaign;
}

/**
 * What Meta's numeric account_status means.
 *
 * A disabled or unsettled account returns no insights and no error worth the name, so
 * a sync against one looks like an account that simply did not spend. Naming the state
 * is the difference between "nothing came back" and "Meta has switched this off".
 */
const ACCOUNT_STATUS: Record<number, string> = {
  1: "active",
  2: "disabled by Meta",
  3: "unsettled — an unpaid balance is blocking it",
  7: "pending risk review",
  8: "pending settlement",
  9: "in grace period",
  100: "pending closure",
  101: "closed",
};

export function describeAccountStatus(status: number): string {
  return ACCOUNT_STATUS[status] ?? `status ${status}`;
}

/**
 * Checks one account end to end: that the token can read the account, and that it can
 * read its insights.
 *
 * The two are separate permissions and fail separately. A token can name an account
 * perfectly well and still be refused its spend, which is the case that looks like an
 * account quietly contributing nothing.
 */
export async function testAccount(
  credentials: MetaCredentials,
): Promise<{ ok: boolean; account: string | null; detail: string }> {
  let described: Awaited<ReturnType<typeof verifyCredentials>>;
  try {
    described = await verifyCredentials(credentials);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      account: null,
      // A thrown fetch is the network, not Meta: it carries no status and no body, and
      // reporting it as a refusal would send someone to the wrong settings screen.
      detail: message.startsWith("Meta Ads:")
        ? message
        : `Could not reach Meta at all (${message}). This is the connection rather than the account — nothing in your Meta settings will change it.`,
    };
  }

  const label = `${described.name} (${described.currency}, ${describeAccountStatus(described.account_status)})`;
  // Only status 1 is a live account. Anything else still answers questions about itself
  // while returning no spend, so an empty result reads as "did not advertise" when the
  // truth is that Meta has stopped the account.
  const live = described.account_status === 1;
  if (!live) {
    return {
      ok: false,
      account: described.name,
      detail: `${label}. Meta is not running this account, so it has no spend to sync whatever the token can see.`,
    };
  }
  // Reading the account is not the same permission as reading its spend, so prove the
  // part the sync actually depends on.
  try {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rows = await fetchDailySpend(credentials, since, new Date());
    const spend = rows.reduce((sum, row) => sum + row.spend, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);

    if (!rows.length) {
      return {
        ok: true,
        account: described.name,
        detail: `${label}. Readable, but Meta returned no campaign rows at all for the last 7 days — nothing ran on this account in that window.`,
      };
    }

    /**
     * Rows but no spend.
     *
     * The case that looks like a broken connection and is not one. Impressions tell the
     * two apart: campaigns that exist but never delivered are a paused account, while
     * delivery with no spend would be a figure Meta is withholding — worth separating,
     * because only one of them is a question for this dashboard.
     */
    if (spend === 0) {
      // Rows that all read as zero are the ambiguous case, so show one as Meta sent it.
      const sample = await fetchInsightsSample(credentials, since, new Date()).catch(
        () => null,
      );
      const raw = sample
        ? ` Meta's first row, verbatim: ${JSON.stringify(sample).slice(0, 400)}`
        : "";
      const lifetime = Number.parseFloat(described.amount_spent ?? "") / 100;
      const history = Number.isFinite(lifetime)
        ? ` Meta puts this account's lifetime spend at ${lifetime.toFixed(2)} ${described.currency}.`
        : ` Meta would not report a lifetime spend figure for this account either, which points the same way.`;
      const purchases = rows.reduce((sum, row) => sum + row.conversions, 0);

      /**
       * Purchases on days Meta reports as having had no delivery at all cannot both be
       * true, and `fetchDailySpend` has already retried without the campaign breakdown
       * by this point. A self-contradicting answer that survives that retry is Meta
       * withholding the cost columns from this token — an access question, not a quiet
       * account — so say which screen fixes it rather than reporting a healthy nothing.
       */
      if (purchases > 0 && impressions === 0) {
        return {
          ok: false,
          account: described.name,
          detail: `${label}. Meta returned ${rows.length} campaign-days recording ${purchases.toLocaleString()} purchases alongside zero spend, zero impressions and zero clicks — figures that cannot all be true at once, and asking again without the campaign breakdown did not recover them. Meta is withholding this account's cost columns from this token. The usual cause is that the token's system user reaches the ad account through partner or analyst access that excludes spend: in Business Settings, assign the system user to this ad account directly with full ad-account access, regenerate the token with ads_read, and test again.${history}${raw}`,
        };
      }

      return {
        ok: true,
        account: described.name,
        detail:
          impressions > 0
            ? `${label}. Meta returned ${rows.length} campaign-days with ${impressions.toLocaleString()} impressions but 0.00 ${described.currency} of spend, which is unusual — check this account in Ads Manager over the same 7 days.${history}${raw}`
            : `${label}. Meta returned ${rows.length} campaign-days, all with no spend, no impressions and no purchases — these campaigns did not deliver in the last 7 days, so there is nothing for this account to contribute.${history}`,
      };
    }

    return {
      ok: true,
      account: described.name,
      detail: `${label}. Read ${rows.length} campaign-days over the last 7 days: ${spend.toFixed(2)} ${described.currency} of spend, ${impressions.toLocaleString()} impressions, ${clicks.toLocaleString()} clicks. This account is syncing.`,
    };
  } catch (error) {
    return {
      ok: false,
      account: described.name,
      detail: `${label}. The account reads fine, but its insights were refused: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export async function verifyCredentials(credentials: MetaCredentials) {
  const account = normalizeAccountId(credentials.adAccountId);
  const params = new URLSearchParams({
    access_token: credentials.accessToken,
    // `amount_spent` is the decisive permission probe: a token barred from an account's
    // cost data gets zeros here too, while one that is merely looking at a quiet week
    // still sees the lifetime figure.
    fields: "name,currency,account_status,amount_spent",
  });
  const response = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${account}?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new MetaError(explainMetaError(response.status, await response.text()));
  }
  return (await response.json()) as {
    name: string;
    currency: string;
    account_status: number;
    /// Lifetime spend in the account currency's minor unit, as a string.
    amount_spent?: string;
  };
}
