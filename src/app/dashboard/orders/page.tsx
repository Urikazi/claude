import { prisma } from "@/lib/db";
import { getActiveStore } from "@/lib/store";
import { formatDate, formatMoney, formatNumber, resolveRange } from "@/lib/format";
import { Card, Empty, Td, Th } from "@/components/ui";
import { RangePicker } from "@/components/range-picker";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { range: rangeParam, from, to } = await searchParams;
  const store = await getActiveStore();
  const range = resolveRange(rangeParam, from, to, store.timezone);

  const orders = await prisma.order.findMany({
    where: { storeId: store.id, processedAt: { gte: range.from, lte: range.to } },
    include: { lineItems: true },
    orderBy: { processedAt: "desc" },
    take: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Orders</h1>
          <p className="mt-0.5 text-sm text-muted">
            Per-order profit after COGS, processing fees and Shopify&apos;s transaction fee.
          </p>
        </div>
        <RangePicker />
      </div>

      <Card title={`${orders.length} orders${orders.length === PAGE_SIZE ? " (most recent)" : ""}`}>
        {orders.length === 0 ? (
          <Empty>No orders in this range.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Date</Th>
                  <Th>Gateway</Th>
                  <Th align="right">Items</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">COGS</Th>
                  <Th align="right">Processing</Th>
                  <Th align="right">Shopify 0.6%</Th>
                  <Th align="right">Profit</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const netRevenue = order.total - order.refundedTotal;
                  const cogs = order.lineItems.reduce(
                    (sum, item) =>
                      sum +
                      (item.unitCogs + item.unitShipping + item.unitHandling) * item.quantity,
                    0,
                  );
                  const units = order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
                  const processing = order.processorFeeActual ?? order.processorFeeEstimate;
                  const profit = netRevenue - cogs - processing - order.shopifyFee;

                  return (
                    <tr key={order.id}>
                      <Td>
                        <span className="block">{order.name ?? order.id.slice(0, 8)}</span>
                        {order.refundedTotal > 0 && (
                          <span className="text-[11px] text-amber-400">
                            refunded {formatMoney(order.refundedTotal, order.currency)}
                          </span>
                        )}
                      </Td>
                      <Td>{formatDate(order.processedAt)}</Td>
                      <Td>
                        <span className="text-muted">
                          {order.gateway.replace(/_/g, " ").toLowerCase()}
                        </span>
                        {order.processorFeeActual !== null && (
                          <span className="ml-1.5 text-[11px] text-pos">actual</span>
                        )}
                      </Td>
                      <Td align="right">{formatNumber(units)}</Td>
                      <Td align="right">{formatMoney(netRevenue, order.currency)}</Td>
                      <Td align="right" className="text-neg">
                        {cogs > 0 ? formatMoney(cogs, order.currency) : "—"}
                      </Td>
                      <Td align="right" className="text-neg">
                        {formatMoney(processing, order.currency)}
                      </Td>
                      <Td align="right" className="text-neg">
                        {formatMoney(order.shopifyFee, order.currency)}
                      </Td>
                      <Td align="right" className={profit >= 0 ? "text-pos" : "text-neg"}>
                        {formatMoney(profit, order.currency)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          Order profit excludes ad spend, which is tracked at the account level rather than per
          order. See the overview for net profit after ads.
        </p>
      </Card>
    </div>
  );
}
