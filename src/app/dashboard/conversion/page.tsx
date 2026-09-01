import Link from "next/link";
import { getActiveStore } from "@/lib/store";
import { formatMoney, formatNumber, resolveRange } from "@/lib/format";
import { todayInZone } from "@/lib/timezone";
import { analyzeChanges, buildConversionReport, type ChangeImpact } from "@/lib/conversion";
import { CHANGE_CATEGORIES } from "@/lib/change-categories";
import { Card, Empty, Stat, Td, Th } from "@/components/ui";
import { RangePicker } from "@/components/range-picker";
import { ConversionChart } from "@/components/conversion-chart";
import { ChangeLogForm } from "@/components/change-log-form";
import { DeleteChangeButton } from "@/components/delete-change-button";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS = new Map<string, string>(
  CHANGE_CATEGORIES.map((c) => [c.value, c.label]),
);

const pct = (value: number) => `${value.toFixed(2)}%`;

export default async function ConversionPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { range: rangeParam, from, to } = await searchParams;
  const store = await getActiveStore();
  const range = resolveRange(rangeParam, from, to, store.timezone);

  const [report, impacts] = await Promise.all([
    buildConversionReport(store.id, range),
    analyzeChanges(store.id, store.timezone),
  ]);

  const { totals } = report;
  const denominator = report.source === "sessions" ? "sessions" : "ad clicks";

  // Numbered newest-first so the chart markers and the table agree at a glance.
  const markers = impacts.map((impact, index) => ({
    date: impact.date,
    title: impact.title,
    index: impacts.length - index,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Conversion rate</h1>
          <p className="mt-0.5 text-sm text-muted">
            {range.label} · new customer orders per {denominator.replace(/s$/, "")}
          </p>
        </div>
        <RangePicker />
      </div>

      {report.source === "clicks" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          No Shopify sessions synced, so this divides by <strong>ad clicks</strong> instead
          — useful, but not your store conversion rate. Add the <code>read_reports</code>{" "}
          scope to your Shopify app, then run the Sessions sync in{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-2">
            settings
          </Link>
          .
        </div>
      ) : null}

      {!report.customersKnown ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          Orders carry no customer, so new and returning cannot be told apart and every
          figure below is blended. Re-run a full Shopify orders sync; if it stays this way,
          your app needs protected customer data access approved.
        </div>
      ) : null}

      {report.customersKnown && report.unattributedOrders > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          {formatNumber(report.unattributedOrders)} older orders were synced before this app
          could read customers, so nobody can be matched to them. A buyer whose earlier order is
          among them reads as new today, which undercounts returning customers and overstates
          the new customer rate. Set <strong>Look back</strong> to cover your history in{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-2">
            settings
          </Link>{" "}
          and run <strong>Re-import every order in the window</strong> to fill them in.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* With no customer on the orders, a first purchase cannot be told from a repeat.
            Showing 0% new and everything as returning would be stating the opposite of
            what is known, so both are withheld until the data supports them. */}
        <Stat
          label="New customer CVR"
          value={report.customersKnown ? pct(totals.newCvr) : "—"}
          hint={
            report.customersKnown
              ? `${formatNumber(totals.newOrders)} first orders`
              : "Needs customer data"
          }
          tone={report.customersKnown ? "positive" : "neutral"}
        />
        <Stat
          label="Blended CVR"
          value={pct(totals.cvr)}
          hint={`${formatNumber(totals.orders)} orders in total`}
        />
        <Stat
          label="Returning CVR"
          value={report.customersKnown ? pct(totals.returningCvr) : "—"}
          hint={
            report.customersKnown
              ? `${formatNumber(totals.returningOrders)} repeat orders`
              : "Needs customer data"
          }
        />
        <Stat
          label={report.source === "sessions" ? "Sessions" : "Ad clicks"}
          value={formatNumber(totals.visits)}
          hint={report.source === "sessions" ? "From Shopify analytics" : "From Meta, as a stand-in"}
        />
      </div>

      {report.source === "sessions" ? (
        <p className="text-xs text-muted">
          Shopify&rsquo;s own conversion rate counts <em>sessions that converted</em>, and only
          from the online store. This counts <em>orders</em> against the same sessions, so it
          reads a little higher: an order placed without a session — a subscription renewal,
          a draft order, anything not from the storefront — has no session to be counted in.
          Both move together; compare each against itself over time rather than against the
          other.
        </p>
      ) : null}

      <Card title="Revenue by customer type">
        <p className="mb-4 text-sm text-muted">
          Every order counts towards revenue, repeat buyers included. This splits the same
          total the P&amp;L reports — it does not filter anything out of it.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Total revenue"
            value={formatMoney(totals.revenue, store.currency)}
            hint={`${formatNumber(totals.orders)} orders, net of refunds`}
          />
          <Stat
            label="From new customers"
            value={
              report.customersKnown ? formatMoney(totals.newRevenue, store.currency) : "—"
            }
            hint={
              report.customersKnown
                ? totals.revenue > 0
                  ? `${((totals.newRevenue / totals.revenue) * 100).toFixed(1)}% of revenue`
                  : undefined
                : "Needs customer data"
            }
          />
          <Stat
            label="From returning customers"
            value={
              report.customersKnown
                ? formatMoney(totals.returningRevenue, store.currency)
                : "—"
            }
            hint={
              report.customersKnown
                ? totals.revenue > 0
                  ? `${((totals.returningRevenue / totals.revenue) * 100).toFixed(1)}% of revenue`
                  : undefined
                : "Needs customer data"
            }
          />
        </div>
      </Card>

      <Card title="Conversion by day">
        {totals.visits > 0 ? (
          <ConversionChart
            data={report.daily}
            markers={markers}
            denominator={denominator}
            customersKnown={report.customersKnown}
          />
        ) : (
          <Empty>
            No {denominator} in this range yet. Sync sessions, or widen the date range.
          </Empty>
        )}
      </Card>

      <Card title="Log a change">
        <p className="mb-3 text-sm text-muted">
          Record every edit you make — a new creative, a price, a rewritten page. Each one
          is marked on the chart and measured against the days either side of it.
        </p>
        <ChangeLogForm storeId={store.id} today={todayInZone(store.timezone)} />
      </Card>

      <Card title={`Change log · ${impacts.length} recorded`}>
        {impacts.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] border-collapse text-sm">
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Change</Th>
                    <Th align="right">Before</Th>
                    <Th align="right">After</Th>
                    <Th align="right">Move</Th>
                    <Th>Read</Th>
                    <Th align="right">{""}</Th>
                  </tr>
                </thead>
                <tbody>
                  {impacts.map((impact, index) => (
                    <ImpactRow
                      key={impact.id}
                      impact={impact}
                      number={impacts.length - index}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-muted">
              Each change is compared against an equal number of days before and after it,
              stopping at the next change so two edits are never mixed. This is an
              observation, not an experiment: traffic mix, spend and season move conversion
              too. &ldquo;Could be noise&rdquo; means the gap is within what these order
              counts would produce by chance anyway.
            </p>
          </>
        ) : (
          <Empty>Nothing logged yet. Record your next edit above and it will be measured.</Empty>
        )}
      </Card>
    </div>
  );
}

const VERDICTS: Record<ChangeImpact["verdict"], { label: string; className: string }> = {
  better: { label: "Likely better", className: "text-pos" },
  worse: { label: "Likely worse", className: "text-neg" },
  unclear: { label: "Could be noise", className: "text-muted" },
  "too-early": { label: "Too early", className: "text-muted" },
  "no-data": { label: "No traffic", className: "text-muted" },
};

function ImpactRow({ impact, number }: { impact: ChangeImpact; number: number }) {
  const verdict = VERDICTS[impact.verdict];
  const moved = impact.deltaPct !== null;
  return (
    <tr className="align-top">
      <Td className="text-muted">{number}</Td>
      <Td>
        <span className="block">{impact.title}</span>
        <span className="text-[11px] text-muted">
          {impact.date} · {CATEGORY_LABELS.get(impact.category) ?? impact.category}
          {impact.windowDays ? ` · ${impact.windowDays}d each side` : ""}
        </span>
        {impact.note ? (
          <span className="mt-1 block max-w-md text-[11px] text-muted">{impact.note}</span>
        ) : null}
      </Td>
      <Td align="right">
        <span className="tabular-nums">{pct(impact.before.cvr)}</span>
        <span className="block text-[11px] text-muted tabular-nums">
          {impact.before.orders}/{formatNumber(impact.before.visits)}
        </span>
      </Td>
      <Td align="right">
        <span className="tabular-nums">{pct(impact.after.cvr)}</span>
        <span className="block text-[11px] text-muted tabular-nums">
          {impact.after.orders}/{formatNumber(impact.after.visits)}
        </span>
      </Td>
      <Td align="right">
        {moved ? (
          <span
            className={`tabular-nums ${impact.deltaPct! >= 0 ? "text-pos" : "text-neg"}`}
          >
            {impact.deltaPct! >= 0 ? "+" : ""}
            {impact.deltaPct!.toFixed(1)}%
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </Td>
      <Td>
        <span className={`text-xs ${verdict.className}`}>{verdict.label}</span>
        {impact.pValue !== null ? (
          <span className="block text-[11px] text-muted tabular-nums">
            p {impact.pValue < 0.001 ? "< 0.001" : impact.pValue.toFixed(3)}
          </span>
        ) : null}
      </Td>
      <Td align="right">
        <DeleteChangeButton id={impact.id} title={impact.title} />
      </Td>
    </tr>
  );
}
