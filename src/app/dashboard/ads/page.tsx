import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { buildPnlReport, newCustomerCost, newCustomerRoas } from "@/lib/pnl";
import { formatDate, formatMoney, formatNumber, resolveRange } from "@/lib/format";
import { round2 } from "@/lib/fees";
import { Card, Empty, Stat, Td, Th } from "@/components/ui";
import { RangePicker } from "@/components/range-picker";
import { NewCustomerPanel } from "@/components/new-customer-panel";
import { PlatformReported } from "@/components/platform-reported";
import { ManualAdSpendForm } from "@/components/manual-ad-spend-form";
import { AdSpendPasteForm } from "@/components/ad-spend-paste-form";
import { DedupeSpendButton } from "@/components/dedupe-spend-button";

export const dynamic = "force-dynamic";

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { range: rangeParam, from, to } = await searchParams;
  const store = await getActiveStore();
  const range = resolveRange(rangeParam, from, to, store.timezone);
  const currency = store.currency;

  const where = { storeId: store.id, date: { gte: range.from, lte: range.to } };
  const [report, entries, grouped, byAccount, accounts, lastMetaSync] = await Promise.all([
    buildPnlReport(store.id, range),
    // The daily list is a recent-activity view and says so; the figures above it are
    // aggregated in the database instead, so nothing depends on this limit.
    prisma.adSpendEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { spend: "desc" }],
      take: 200,
    }),
    /**
     * Campaign totals, summed by the database rather than by reading rows back.
     *
     * These were built from the 200 rows fetched above, which quietly truncated the
     * table: a store running two ad accounts over sixty days has hundreds of rows, so
     * the campaign list showed a fraction of the spend while the total above it was
     * right — the two disagreeing with no sign of why.
     */
    prisma.adSpendEntry.groupBy({
      by: ["platform", "campaignId", "campaignName", "adAccountId"],
      where,
      _sum: { spend: true, clicks: true, impressions: true, conversions: true },
    }),
    prisma.adSpendEntry.groupBy({
      by: ["adAccountId"],
      where,
      _sum: { spend: true, conversions: true, conversionValue: true },
    }),
    prisma.metaAdAccount.findMany({
      where: { storeId: store.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.syncLog.findFirst({
      where: { storeId: store.id, source: "meta" },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  // Ad accounts are named on screen where the operator gave them a name; an id is no
  // help in telling two apart.
  const accountLabel = new Map(
    accounts.map((account) => [account.accountId, account.label?.trim() || account.accountId]),
  );
  const nameAccount = (id: string) => (id ? (accountLabel.get(id) ?? id) : "Unattributed");

  const campaigns = grouped
    .map((row) => ({
      name: row.campaignName ?? "Unattributed",
      platform: row.platform,
      campaignId: row.campaignId,
      account: nameAccount(row.adAccountId),
      spend: round2(row._sum.spend ?? 0),
      clicks: row._sum.clicks ?? 0,
      impressions: row._sum.impressions ?? 0,
      conversions: row._sum.conversions ?? 0,
    }))
    .sort((a, b) => b.spend - a.spend);

  /**
   * Spend per ad account — every connected account, including one that contributed
   * nothing.
   *
   * Listing only the accounts with rows is what makes a failed sync invisible: an
   * account whose fetch is being refused simply does not appear, and the total looks
   * like the whole picture. An account showing zero is a question worth asking; an
   * account missing from the page is not a question at all.
   */
  const spendByAccountId = new Map(
    byAccount.map((row) => [
      row.adAccountId,
      {
        spend: round2(row._sum.spend ?? 0),
        conversions: row._sum.conversions ?? 0,
        conversionValue: round2(row._sum.conversionValue ?? 0),
      },
    ]),
  );
  const connected = accounts.map((account) => ({
    account: account.label?.trim() || account.accountId,
    accountId: account.accountId,
    active: account.active,
    ...(spendByAccountId.get(account.accountId) ?? {
      spend: 0,
      conversions: 0,
      conversionValue: 0,
    }),
  }));
  // Spend billed to an account the store no longer lists — a removed account's history.
  const orphaned = [...spendByAccountId.entries()]
    .filter(([id]) => id && !accounts.some((account) => account.accountId === id))
    .map(([id, row]) => ({ account: id, accountId: id, active: false, ...row }));
  const accountRows = [...connected, ...orphaned].sort((a, b) => b.spend - a.spend);
  const silentAccounts = accountRows.filter((row) => row.active && row.spend === 0);

  const { totals } = report;
  const ncRoas = newCustomerRoas(totals, store.metaReportsNewCustomersOnly);
  const ncCost = newCustomerCost(totals, store.metaReportsNewCustomersOnly);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Ad spend</h1>
          <p className="mt-0.5 text-sm text-muted">
            Meta Ads syncs automatically. Add other channels manually below.
          </p>
        </div>
        <RangePicker />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Total spend" value={formatMoney(totals.adSpend, currency)} />
        {/* nc-ROAS leads: ads buy first purchases, and blended credits them with repeat
            ones they did not have to pay for. */}
        <Stat
          label="nc-ROAS"
          value={ncRoas.available ? `${ncRoas.value.toFixed(2)}x` : "—"}
          hint={
            ncRoas.available
              ? ncRoas.source === "meta"
                ? `${formatMoney(totals.platformConversionValue, currency)} attributed by Meta`
                : "New customer revenue ÷ ad spend"
              : "Needs customer data on orders"
          }
          tone={ncRoas.available ? (ncRoas.value >= 1 ? "positive" : "negative") : "neutral"}
        />
        <Stat
          label="Blended ROAS"
          value={`${totals.roas.toFixed(2)}x`}
          hint="All revenue ÷ ad spend"
        />
        <Stat
          label="POAS"
          value={`${totals.poas.toFixed(2)}x`}
          hint="Gross profit ÷ ad spend"
          tone={totals.poas >= 1 ? "positive" : "negative"}
        />
        <Stat
          label="Cost per new customer"
          value={ncCost.available ? formatMoney(ncCost.value, currency) : "—"}
          hint={
            ncCost.available
              ? ncCost.source === "meta"
                ? `${formatNumber(totals.platformConversions)} new customers, by Meta`
                : `${formatNumber(totals.newCustomerOrders)} first orders`
              : "Needs customer data on orders"
          }
        />
        <Stat
          label="Cost per order"
          value={formatMoney(totals.cpa, currency)}
          hint={`${formatNumber(totals.orders)} orders, new and repeat`}
        />
      </div>

      {/* Only when the tiles above are not already showing these numbers — otherwise the
          card repeats them, and a figure printed twice invites a search for the difference
          between two copies of the same thing. */}
      {ncRoas.source === "meta" && ncCost.source === "meta" ? null : (
        <Card title="As Meta reports it">
          <PlatformReported
            totals={totals}
            currency={currency}
            newCustomersOnly={store.metaReportsNewCustomersOnly}
          />
        </Card>
      )}

      <Card title="New customers only, against all orders">
        <NewCustomerPanel
          totals={totals}
          currency={currency}
          ncRoas={ncRoas}
          ncCost={ncCost}
        />
      </Card>

      <Card title="Spend by platform">
        {report.adSpendByPlatform.length === 0 ? (
          <Empty>No ad spend recorded in this range.</Empty>
        ) : (
          <div className="flex flex-wrap gap-3">
            {report.adSpendByPlatform.map((row) => (
              <div key={row.platform} className="rounded-lg border border-line bg-panel-2 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-muted">{row.platform}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {formatMoney(row.spend, currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Paste spend from Ads Manager">
        <AdSpendPasteForm storeId={store.id} />
        <div className="mt-4 border-t border-line pt-4">
          <DedupeSpendButton storeId={store.id} />
        </div>
      </Card>

      <Card title="Add a single day">
        <ManualAdSpendForm storeId={store.id} />
      </Card>

      {accountRows.length > 1 || silentAccounts.length ? (
        <Card title="By ad account">
          <p className="mb-3 text-sm text-muted">
            Every connected account&rsquo;s spend is added into the totals above. This is the
            same spend, split by where it was billed.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr>
                  <Th>Ad account</Th>
                  <Th align="right">Spend</Th>
                  <Th align="right">Share</Th>
                  <Th align="right">Purchases</Th>
                  <Th align="right">Platform ROAS</Th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((row) => (
                  <tr key={row.accountId || row.account}>
                    <Td>
                      {row.account}
                      {!row.active ? (
                        <span className="ml-2 text-[11px] text-muted">not syncing</span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      {formatMoney(row.spend, currency)}
                      {row.active && row.spend === 0 ? (
                        <span className="block text-[11px] text-neg">nothing synced</span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      {totals.adSpend > 0
                        ? `${((row.spend / totals.adSpend) * 100).toFixed(1)}%`
                        : "—"}
                    </Td>
                    <Td align="right">{formatNumber(row.conversions)}</Td>
                    <Td align="right">
                      {row.spend > 0 ? `${(row.conversionValue / row.spend).toFixed(2)}x` : "—"}
                    </Td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <Td>Total</Td>
                  <Td align="right">
                    {formatMoney(
                      round2(accountRows.reduce((sum, row) => sum + row.spend, 0)),
                      currency,
                    )}
                  </Td>
                  <Td align="right">100.0%</Td>
                  <Td align="right">
                    {formatNumber(accountRows.reduce((sum, row) => sum + row.conversions, 0))}
                  </Td>
                  <Td align="right">{""}</Td>
                </tr>
              </tbody>
            </table>
          </div>
          {silentAccounts.length ? (
            <p className="mt-3 text-xs text-neg">
              {silentAccounts.map((row) => row.account).join(" and ")}{" "}
              {silentAccounts.length === 1 ? "is connected but has" : "are connected but have"}{" "}
              no spend in this range, so {silentAccounts.length === 1 ? "it is" : "they are"}{" "}
              contributing nothing to the total above. Either{" "}
              {silentAccounts.length === 1 ? "it" : "they"} genuinely did not spend, or the
              sync is not reaching {silentAccounts.length === 1 ? "it" : "them"}.
              {lastMetaSync?.status === "error"
                ? ` The last Meta sync failed: ${lastMetaSync.message ?? "no detail"}`
                : " Run Sync all and read the Meta line for what came back per account."}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            Platform ROAS is each account&rsquo;s own attributed value over its own spend.
            Accounts attribute separately, so these do not sum to a blended figure and the
            values behind them must not be added to Shopify revenue.
          </p>
        </Card>
      ) : null}

      <Card title="Campaigns">
        {campaigns.length === 0 ? (
          <Empty>Nothing to show. Connect Meta Ads in Settings, then sync.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <Th>Campaign</Th>
                  <Th>Ad account</Th>
                  <Th>Platform</Th>
                  <Th align="right">Spend</Th>
                  <Th align="right">Impressions</Th>
                  <Th align="right">Clicks</Th>
                  <Th align="right">CPC</Th>
                  <Th align="right">Purchases</Th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((row) => (
                  <tr key={`${row.platform}:${row.campaignId}:${row.account}`}>
                    <Td>{row.name}</Td>
                    <Td>
                      <span className="text-muted">{row.account}</span>
                    </Td>
                    <Td>
                      <span className="text-muted">{row.platform}</span>
                    </Td>
                    <Td align="right">{formatMoney(row.spend, currency)}</Td>
                    <Td align="right">{formatNumber(row.impressions)}</Td>
                    <Td align="right">{formatNumber(row.clicks)}</Td>
                    <Td align="right">
                      {row.clicks > 0
                        ? formatMoney(round2(row.spend / row.clicks), currency)
                        : "—"}
                    </Td>
                    <Td align="right">{formatNumber(row.conversions)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Daily entries">
        {entries.length === 0 ? (
          <Empty>No entries.</Empty>
        ) : (
          <>
          {entries.length >= 200 ? (
            <p className="mb-3 text-xs text-muted">
              The 200 most recent rows. The figures above cover the whole range.
            </p>
          ) : null}
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[560px]">
              <thead className="sticky top-0 bg-panel">
                <tr>
                  <Th>Date</Th>
                  <Th>Campaign</Th>
                  <Th>Platform</Th>
                  <Th align="right">Spend</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <Td>{formatDate(entry.date)}</Td>
                    <Td>{entry.campaignName ?? "—"}</Td>
                    <Td>
                      <span className="text-muted">{entry.platform}</span>
                    </Td>
                    <Td align="right">{formatMoney(entry.spend, currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </div>
  );
}
