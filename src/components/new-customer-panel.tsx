import type { PnlTotals } from "@/lib/pnl";
import { formatMoney, formatNumber } from "@/lib/format";
import { Td, Th } from "@/components/ui";

/**
 * The same figures on two bases, side by side.
 *
 * Ads buy first purchases, so every per-order number that includes repeat buyers
 * flatters the spend: the orders are real but the ads did not have to pay for them.
 * Showing both columns makes the size of that difference the point, rather than
 * leaving it to be inferred from two numbers on opposite ends of a page.
 */
export function NewCustomerPanel({
  totals,
  currency,
}: {
  totals: PnlTotals;
  currency: string;
}) {
  if (!totals.customersKnown) {
    return (
      <p className="py-6 text-sm text-muted">
        Orders carry no customer, so a first purchase cannot be told from a repeat. Grant the{" "}
        <code>read_customers</code> scope and re-import your orders to fill this in.
      </p>
    );
  }

  const repeatOrders = totals.orders - totals.newCustomerOrders;
  const repeatRevenue = Math.round((totals.netRevenue - totals.newCustomerRevenue) * 100) / 100;

  const rows: { label: string; nc: string; all: string; hint?: string }[] = [
    {
      label: "Orders",
      nc: formatNumber(totals.newCustomerOrders),
      all: formatNumber(totals.orders),
      hint: `${formatNumber(repeatOrders)} repeat`,
    },
    {
      label: "Revenue",
      nc: formatMoney(totals.newCustomerRevenue, currency),
      all: formatMoney(totals.netRevenue, currency),
      hint: `${formatMoney(repeatRevenue, currency)} repeat`,
    },
    {
      label: "Average order value",
      nc: formatMoney(totals.newCustomerAov, currency),
      all: formatMoney(totals.aov, currency),
    },
    {
      label: "Cost per order",
      nc: totals.cac > 0 ? formatMoney(totals.cac, currency) : "—",
      all: totals.cpa > 0 ? formatMoney(totals.cpa, currency) : "—",
      hint: "Ad spend ÷ orders, from Shopify",
    },
    {
      label: "Return on ad spend",
      nc: `${totals.ncRoas.toFixed(2)}x`,
      all: `${totals.roas.toFixed(2)}x`,
      hint: "Shopify revenue ÷ ad spend",
    },
  ];

  // What a first purchase leaves after the ad that bought it. Negative means each new
  // customer is acquired at a loss and has to be earned back on a second order.
  const contribution = Math.round((totals.newCustomerAov - totals.cac) * 100) / 100;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <thead>
            <tr>
              <Th>{""}</Th>
              <Th align="right">New customers</Th>
              <Th align="right">All orders</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <Td>
                  <span className="block">{row.label}</span>
                  {row.hint ? (
                    <span className="text-[11px] text-muted">{row.hint}</span>
                  ) : null}
                </Td>
                <Td align="right">
                  <span className="font-medium tabular-nums text-accent">{row.nc}</span>
                </Td>
                <Td align="right">
                  <span className="tabular-nums text-muted">{row.all}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totals.cac > 0 ? (
        <p className="text-xs text-muted">
          A first order is worth{" "}
          <strong className="text-body">{formatMoney(totals.newCustomerAov, currency)}</strong> and
          costs{" "}
          <strong className="text-body">{formatMoney(totals.cac, currency)}</strong> in ads, so it{" "}
          {contribution >= 0 ? (
            <>
              clears{" "}
              <strong className="text-pos">{formatMoney(contribution, currency)}</strong> before
              goods and fees.
            </>
          ) : (
            <>
              lands{" "}
              <strong className="text-neg">{formatMoney(Math.abs(contribution), currency)}</strong>{" "}
              short before goods and fees are even counted — every new customer has to be earned
              back on a second order.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
