import Link from "next/link";
import {
  buildPnlReport,
  buildProductPnl,
  countUncostedVariants,
  percentChange,
  previousRange,
} from "@/lib/pnl";
import { getActiveStore } from "@/lib/store";
import { formatMoney, formatNumber, formatPercent, resolveRange } from "@/lib/format";
import { Card, Delta, Empty, Stat, Td, Th } from "@/components/ui";
import { CostBreakdown } from "@/components/cost-breakdown";
import { SalesBreakdown } from "@/components/sales-breakdown";
import { PnlChart } from "@/components/pnl-chart";
import { RangePicker } from "@/components/range-picker";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { range: rangeParam, from, to } = await searchParams;
  const store = await getActiveStore();
  const range = resolveRange(rangeParam, from, to, store.timezone);
  const currency = store.currency;

  const [report, previous, products, missingCosts] = await Promise.all([
    buildPnlReport(store.id, range),
    buildPnlReport(store.id, previousRange(range)),
    buildProductPnl(store.id, range),
    countUncostedVariants(store.id),
  ]);

  const { totals } = report;
  const prior = previous.totals;
  const totalCosts = totals.cogs + totals.shippingCost + totals.handlingCost;
  const totalFees = totals.processorFees + totals.shopifyFees;
  const priorCosts = prior.cogs + prior.shippingCost + prior.handlingCost;
  const priorFees = prior.processorFees + prior.shopifyFees;
  const allCosts = totalCosts + totalFees + totals.adSpend;

  const costSlices = [
    { label: "Cost of goods", value: totals.cogs },
    { label: "Ad spend", value: totals.adSpend },
    { label: "Shipping", value: totals.shippingCost },
    { label: "Transaction fees", value: totalFees },
    { label: "Handling", value: totals.handlingCost },
  ];

  const change = (current: number, was: number) => percentChange(current, was);

  const waterfall: { label: string; value: number; kind: "in" | "out" | "result" }[] = [
    { label: "Total sales", value: totals.netRevenue, kind: "in" },
    { label: "Cost of goods", value: -totals.cogs, kind: "out" },
    { label: "Shipping & handling", value: -(totals.shippingCost + totals.handlingCost), kind: "out" },
    { label: "Payment processing fees", value: -totals.processorFees, kind: "out" },
    { label: "Shopify transaction fees", value: -totals.shopifyFees, kind: "out" },
    { label: "Gross profit", value: totals.grossProfit, kind: "result" },
    { label: "Ad spend", value: -totals.adSpend, kind: "out" },
    { label: "Net profit", value: totals.netProfit, kind: "result" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Profit &amp; loss</h1>
          <p className="mt-0.5 text-sm text-muted">{range.label}</p>
        </div>
        <RangePicker />
      </div>

      {missingCosts > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          {missingCosts} variant{missingCosts === 1 ? " has" : "s have"} no COGS set — profit is
          overstated until you fill them in.{" "}
          <Link href="/dashboard/products" className="underline underline-offset-2">
            Enter costs
          </Link>
        </div>
      )}

      {/* The one number the whole page exists to produce, sized to say so. */}
      <div className="rounded-xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Net profit
            </p>
            <p
              className={`mt-1 text-4xl font-semibold tabular-nums ${
                totals.netProfit >= 0 ? "text-pos" : "text-neg"
              }`}
            >
              {formatMoney(totals.netProfit, currency)}
            </p>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted">
              <Delta change={change(totals.netProfit, prior.netProfit)} />
              <span>vs previous {range.days === 1 ? "day" : `${range.days} days`}</span>
              <span className="tabular-nums">
                {formatMoney(prior.netProfit, currency)}
              </span>
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Orders", value: formatNumber(totals.orders), c: change(totals.orders, prior.orders), up: true },
              { label: "Units sold", value: formatNumber(totals.units), c: change(totals.units, prior.units), up: true },
              { label: "Margin", value: formatPercent(totals.margin), c: change(totals.margin, prior.margin), up: true },
              // ROAS earns revenue back, POAS earns profit back; the pair together says
              // whether a campaign that looks fine on revenue actually pays for itself.
              { label: "ROAS", value: `${totals.roas.toFixed(2)}x`, c: change(totals.roas, prior.roas), up: true },
              { label: "POAS", value: `${totals.poas.toFixed(2)}x`, c: change(totals.poas, prior.poas), up: true },
            ].map((item) => (
              <div key={item.label}>
                <dt className="text-xs text-muted">{item.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{item.value}</dd>
                <Delta change={item.c} higherIsBetter={item.up} />
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Total sales"
          value={formatMoney(totals.netRevenue, currency)}
          change={change(totals.netRevenue, prior.netRevenue)}
          hint={`AOV ${formatMoney(totals.aov, currency)} · same basis as Shopify`}
        />
        <Stat
          label="Ad spend"
          value={formatMoney(totals.adSpend, currency)}
          change={change(totals.adSpend, prior.adSpend)}
          // Spending more is not itself bad, but on this page it is a cost line.
          higherIsBetter={false}
          hint={`ROAS ${totals.roas.toFixed(2)}x · CPA ${formatMoney(totals.cpa, currency)}`}
        />
        <Stat
          label="COGS"
          value={formatMoney(totalCosts, currency)}
          change={change(totalCosts, priorCosts)}
          higherIsBetter={false}
          hint={
            totals.netRevenue > 0
              ? `${formatPercent((totalCosts / totals.netRevenue) * 100)} of revenue`
              : "Goods, shipping and handling"
          }
        />
        <Stat
          label="Fees"
          value={formatMoney(totalFees, currency)}
          change={change(totalFees, priorFees)}
          higherIsBetter={false}
          hint={
            totals.netRevenue > 0
              ? `${formatPercent((totalFees / totals.netRevenue) * 100)} of revenue`
              : "Processor and Shopify fees"
          }
        />
        <Stat
          label="Gross profit"
          value={formatMoney(totals.grossProfit, currency)}
          change={change(totals.grossProfit, prior.grossProfit)}
          hint="Before ad spend"
        />
      </div>

      <Card title="Revenue, ad spend and profit by day">
        {totals.orders === 0 && totals.adSpend === 0 ? (
          <Empty>
            No data for this range. Connect your APIs in{" "}
            <Link href="/dashboard/settings" className="text-accent underline underline-offset-2">
              Settings
            </Link>{" "}
            and hit Sync all.
          </Empty>
        ) : (
          <PnlChart data={report.daily} currency={currency} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Total sales">
          <SalesBreakdown totals={totals} currency={currency} />
        </Card>

        <Card title="Cost breakdown">
          <CostBreakdown slices={costSlices} currency={currency} />
        </Card>

        <Card title="Order summary">
          <dl className="divide-y divide-line text-sm">
            {[
              ["Average order value", formatMoney(totals.aov, currency)],
              [
                "Ad spend per order",
                formatMoney(totals.orders ? totals.adSpend / totals.orders : 0, currency),
              ],
              [
                "Average order cost",
                formatMoney(
                  totals.orders ? (totalCosts + totalFees) / totals.orders : 0,
                  currency,
                ),
              ],
              [
                "Average order profit",
                formatMoney(totals.orders ? totals.netProfit / totals.orders : 0, currency),
              ],
              ["Units per order", totals.orders ? (totals.units / totals.orders).toFixed(2) : "0"],
              ["Blended ROAS", `${totals.roas.toFixed(2)}x`],
              ["POAS", `${totals.poas.toFixed(2)}x`],
              [
                "Cost as share of revenue",
                totals.netRevenue > 0
                  ? formatPercent((allCosts / totals.netRevenue) * 100)
                  : "—",
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-2">
                <dt className="text-muted">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="P&L breakdown">
          <ul className="space-y-1">
            {waterfall.map((row) => (
              <li
                key={row.label}
                className={`flex items-center justify-between gap-4 rounded-lg px-3 py-2 text-sm ${
                  row.kind === "result" ? "bg-panel-2 font-semibold" : ""
                }`}
              >
                <span className={row.kind === "result" ? "text-body" : "text-muted"}>
                  {row.label}
                </span>
                <span
                  className={`tabular-nums ${
                    row.kind === "out"
                      ? "text-neg"
                      : row.value >= 0
                        ? "text-pos"
                        : "text-neg"
                  }`}
                >
                  {formatMoney(row.value, currency)}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Fees by payment method">
          {report.feesBreakdown.length === 0 ? (
            <Empty>No orders in this range.</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Gateway</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Fees</Th>
                </tr>
              </thead>
              <tbody>
                {report.feesBreakdown.map((row) => (
                  <tr key={row.gateway}>
                    <Td>{row.gateway.replace(/_/g, " ").toLowerCase()}</Td>
                    <Td align="right">{formatNumber(row.orders)}</Td>
                    <Td align="right" className="text-neg">
                      {formatMoney(row.fees, currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-muted">
            Real Stripe and PayPal fees replace the estimates once you run a fee sync. Shopify&apos;s
            transaction fee is applied to every order not paid through Shopify Payments.
          </p>
        </Card>
      </div>

      <Card
        title="Top products by revenue"
        action={
          <Link href="/dashboard/products" className="text-xs text-accent hover:underline">
            Manage COGS →
          </Link>
        }
      >
        {products.length === 0 ? (
          <Empty>No sales in this range.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">COGS</Th>
                  <Th align="right">Profit</Th>
                  <Th align="right">Margin</Th>
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 10).map((row) => (
                  <tr key={row.key}>
                    <Td>
                      <span className="block">{row.title}</span>
                      {!row.hasCost && (
                        <span className="text-[11px] text-amber-400">no COGS set</span>
                      )}
                    </Td>
                    <Td align="right">{formatNumber(row.units)}</Td>
                    <Td align="right">{formatMoney(row.revenue, currency)}</Td>
                    <Td align="right" className="text-neg">
                      {formatMoney(row.cogs, currency)}
                    </Td>
                    <Td align="right" className={row.profit >= 0 ? "text-pos" : "text-neg"}>
                      {formatMoney(row.profit, currency)}
                    </Td>
                    <Td align="right">{formatPercent(row.margin)}</Td>
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
