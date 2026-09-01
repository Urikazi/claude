import type { PnlTotals } from "@/lib/pnl";
import { formatMoney, formatNumber } from "@/lib/format";

/**
 * Meta's own figures, reproduced rather than recalculated.
 *
 * These are the numbers in Ads Manager: purchases and value as Meta's attribution
 * assigns them, over its own window and its own view of what a conversion is. They will
 * not equal the Shopify-derived figures beside them, and are not meant to — a platform
 * credits itself with sales it believes it caused, while Shopify records the ones that
 * happened. Both are useful; averaging them or preferring whichever looks better is not.
 *
 * What the conversion counts is the store's to declare. An account optimising for a
 * new customer purchase already reports a new customer ROAS, and calling it a purchase
 * ROAS covering everyone would misdescribe the store's own configuration.
 */
export function PlatformReported({
  totals,
  currency,
  newCustomersOnly = false,
}: {
  totals: PnlTotals;
  currency: string;
  newCustomersOnly?: boolean;
}) {
  const hasData = totals.platformConversions > 0 || totals.platformConversionValue > 0;

  if (!hasData) {
    return (
      <p className="py-6 text-sm text-muted">
        No purchase data from Meta in this range. Run a Meta Ads sync; if it stays empty,
        the ad account is reporting spend without attributed purchases.
      </p>
    );
  }

  const tiles = [
    {
      label: newCustomersOnly ? "New customer ROAS" : "Purchase ROAS",
      value: `${totals.platformRoas.toFixed(2)}x`,
      hint: `${formatMoney(totals.platformConversionValue, currency)} attributed`,
      tone: totals.platformRoas >= 1,
    },
    {
      label: newCustomersOnly ? "Cost per new customer" : "Cost per purchase",
      value:
        totals.platformCostPerPurchase > 0
          ? formatMoney(totals.platformCostPerPurchase, currency)
          : "—",
      hint: `${formatNumber(totals.platformConversions)} ${
        newCustomersOnly ? "new customers" : "purchases"
      }`,
      tone: null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-line bg-panel-2 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted">{tile.label}</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                tile.tone === null ? "" : tile.tone ? "text-pos" : "text-neg"
              }`}
            >
              {tile.value}
            </p>
            <p className="mt-0.5 text-xs text-muted">{tile.hint}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Straight from Meta, on its attribution and its window — the same figures Ads Manager
        shows.{" "}
        {newCustomersOnly
          ? "Your ad account is set to report new customers only, so this is already a new customer figure and can be read against the Shopify-derived one above. They still count differently — Meta credits a sale it believes its ad caused, Shopify records the sale that happened — so treat a gap as attribution, not as either being wrong."
          : "Meta counts a sale when it believes its ad caused one, new customer or repeat, which is why these differ from the Shopify-derived numbers above rather than confirming them."}
      </p>
    </div>
  );
}
