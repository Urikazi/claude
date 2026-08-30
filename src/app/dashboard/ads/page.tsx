import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { buildPnlReport } from "@/lib/pnl";
import { formatDate, formatMoney, formatNumber, resolveRange } from "@/lib/format";
import { round2 } from "@/lib/fees";
import { Card, Empty, Stat, Td, Th } from "@/components/ui";
import { RangePicker } from "@/components/range-picker";
import { ManualAdSpendForm } from "@/components/manual-ad-spend-form";

export const dynamic = "force-dynamic";

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range = resolveRange(rangeParam);
  const store = await getActiveStore();
  const currency = store.currency;

  const [report, entries] = await Promise.all([
    buildPnlReport(store.id, range),
    prisma.adSpendEntry.findMany({
      where: { storeId: store.id, date: { gte: range.from, lte: range.to } },
      orderBy: [{ date: "desc" }, { spend: "desc" }],
      take: 200,
    }),
  ]);

  const byCampaign = new Map<
    string,
    { name: string; platform: string; spend: number; clicks: number; impressions: number; conversions: number }
  >();
  for (const entry of entries) {
    const key = `${entry.platform}:${entry.campaignId}`;
    const row = byCampaign.get(key) ?? {
      name: entry.campaignName ?? "Unattributed",
      platform: entry.platform,
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
    };
    row.spend += entry.spend;
    row.clicks += entry.clicks;
    row.impressions += entry.impressions;
    row.conversions += entry.conversions;
    byCampaign.set(key, row);
  }
  const campaigns = [...byCampaign.values()].sort((a, b) => b.spend - a.spend);

  const { totals } = report;

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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total spend" value={formatMoney(totals.adSpend, currency)} />
        <Stat
          label="ROAS"
          value={`${totals.roas.toFixed(2)}x`}
          hint="Net revenue ÷ ad spend"
        />
        <Stat
          label="POAS"
          value={`${totals.poas.toFixed(2)}x`}
          hint="Gross profit ÷ ad spend"
          tone={totals.poas >= 1 ? "positive" : "negative"}
        />
        <Stat
          label="Cost per order"
          value={formatMoney(totals.cpa, currency)}
          hint={`${formatNumber(totals.orders)} orders`}
        />
      </div>

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

      <Card title="Add spend from another channel">
        <ManualAdSpendForm storeId={store.id} />
      </Card>

      <Card title="Campaigns">
        {campaigns.length === 0 ? (
          <Empty>Nothing to show. Connect Meta Ads in Settings, then sync.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <Th>Campaign</Th>
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
                  <tr key={`${row.platform}:${row.name}`}>
                    <Td>{row.name}</Td>
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
        )}
      </Card>
    </div>
  );
}
