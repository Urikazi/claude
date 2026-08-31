import type { PnlTotals } from "@/lib/pnl";
import { formatMoney } from "@/lib/format";

/**
 * Reconciles what Shopify calls Total sales, line by line.
 *
 * Shopify computes it as gross sales less discounts and returns, plus shipping and
 * tax. Showing only the result made it impossible to tell a figure that is behind
 * Shopify from one that is counting something differently, which is a slow way to
 * lose trust in every other number on the page.
 *
 * Anything the named rows do not account for — duties, tips — is shown as its own row
 * rather than being folded silently into one of them, so the column always adds up.
 */
export function SalesBreakdown({
  totals,
  currency,
}: {
  totals: PnlTotals;
  currency: string;
}) {
  const named =
    totals.grossRevenue - totals.discounts + totals.shippingCharged + totals.taxes - totals.refunds;
  const other = Math.round((totals.netRevenue - named) * 100) / 100;

  const rows: { label: string; value: number; hint?: string }[] = [
    { label: "Gross sales", value: totals.grossRevenue, hint: "Line items at full price" },
    { label: "Discounts", value: -totals.discounts },
    { label: "Shipping charged", value: totals.shippingCharged },
    { label: "Taxes", value: totals.taxes },
    { label: "Refunds", value: -totals.refunds },
  ];
  if (other !== 0) {
    rows.push({ label: "Other", value: other, hint: "Duties, tips and anything else Shopify adds" });
  }

  return (
    <div className="max-w-md">
      <ul className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.label} className="flex items-baseline justify-between gap-4">
            <span className="text-muted">
              {row.label}
              {row.hint ? (
                <span className="ml-1.5 text-[11px] text-muted/70">{row.hint}</span>
              ) : null}
            </span>
            <span className={`shrink-0 tabular-nums ${row.value < 0 ? "text-neg" : ""}`}>
              {row.value < 0 ? "−" : ""}
              {formatMoney(Math.abs(row.value), currency)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-2 text-sm font-semibold">
        <span>Total sales</span>
        <span className="tabular-nums">{formatMoney(totals.netRevenue, currency)}</span>
      </div>
      <p className="mt-3 text-xs text-muted">
        This is the figure Shopify shows as <strong>Total sales</strong>. If it disagrees with
        Shopify, check the sync time in the header first — orders placed since the last sync
        are not counted yet.
      </p>
    </div>
  );
}
