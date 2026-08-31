import Link from "next/link";
import { prisma } from "@/lib/db";
import { buildPnlReport, buildProductPnl } from "@/lib/pnl";
import { getActiveStore } from "@/lib/store";
import { formatMoney, formatNumber, formatPercent, resolveRange } from "@/lib/format";
import { Card, Empty, Stat, Td, Th } from "@/components/ui";
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

  const [report, products, missingCosts] = await Promise.all([
    buildPnlReport(store.id, range),
    buildProductPnl(store.id, range),
    prisma.productVariant.count({
      where: { product: { storeId: store.id }, cogs: 0 },
    }),
  ]);

  const { totals } = report;
  const totalCosts = totals.cogs + totals.shippingCost + totals.handlingCost;
  const totalFees = totals.processorFees + totals.shopifyFees;

  const waterfall: { label: string; value: number; kind: "in" | "out" | "result" }[] = [
    { label: "Net revenue", value: totals.netRevenue, kind: "in" },
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Net revenue"
          value={formatMoney(totals.netRevenue, currency)}
          hint={`${formatNumber(totals.orders)} orders · AOV ${formatMoney(totals.aov, currency)}`}
        />
        <Stat
          label="Ad spend"
          value={formatMoney(totals.adSpend, currency)}
          hint={`ROAS ${totals.roas.toFixed(2)}x · CPA ${formatMoney(totals.cpa, currency)}`}
        />
        <Stat
          label="COGS"
          value={formatMoney(totalCosts, currency)}
          hint={
            totals.netRevenue > 0
              ? `${formatPercent((totalCosts / totals.netRevenue) * 100)} of revenue`
              : "Goods, shipping and handling"
          }
        />
        <Stat
          label="Fees"
          value={formatMoney(totalFees, currency)}
          hint={
            totals.netRevenue > 0
              ? `${formatPercent((totalFees / totals.netRevenue) * 100)} of revenue`
              : "Processor and Shopify fees"
          }
        />
        <Stat
          label="Net profit"
          value={formatMoney(totals.netProfit, currency)}
          hint={`Margin ${formatPercent(totals.margin)} · POAS ${totals.poas.toFixed(2)}x`}
          tone={totals.netProfit >= 0 ? "positive" : "negative"}
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
