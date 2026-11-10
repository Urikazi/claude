import { formatMoney } from "@/lib/format";
import { Td, Th } from "@/components/ui";
import type { PnlDaily, PnlTotals } from "@/lib/pnl";

/**
 * Where a day's cost figure came from.
 *
 * The supplier bills a day's orders the following day, so the most recent day always
 * reads on estimates until the next ledger import. Saying so per row is the difference
 * between a profit figure and a guess that looks like one.
 */
function costSource(row: PnlTotals): { label: string; className: string } {
  if (!row.orders) return { label: "", className: "" };
  if (row.billedOrders >= row.orders) return { label: "billed", className: "text-pos" };
  if (row.billedOrders === 0) return { label: "estimate", className: "text-amber-300" };
  return {
    label: `${row.billedOrders}/${row.orders} billed`,
    className: "text-amber-300",
  };
}

const totalCogs = (row: PnlTotals) => row.cogs + row.shippingCost + row.handlingCost;
const totalFees = (row: PnlTotals) => row.processorFees + row.shopifyFees;

function Row({
  label,
  row,
  currency,
  strong = false,
}: {
  label: string;
  row: PnlTotals;
  currency: string;
  strong?: boolean;
}) {
  const source = costSource(row);
  return (
    <tr className={strong ? "border-t border-line font-semibold" : "border-b border-line/60"}>
      <Td>{label}</Td>
      <Td align="right" className="tabular-nums">
        {formatMoney(row.adSpend, currency)}
      </Td>
      <Td align="right" className="tabular-nums">
        {formatMoney(totalCogs(row), currency)}
        {source.label ? (
          <span className={`block text-[11px] font-normal ${source.className}`}>{source.label}</span>
        ) : null}
      </Td>
      <Td align="right" className="tabular-nums">
        {formatMoney(row.netRevenue, currency)}
      </Td>
      <Td align="right" className="tabular-nums">
        {formatMoney(totalFees(row), currency)}
      </Td>
      <Td
        align="right"
        className={`tabular-nums ${row.netProfit >= 0 ? "text-pos" : "text-neg"}`}
      >
        {formatMoney(row.netProfit, currency)}
      </Td>
      <Td
        align="right"
        className={`tabular-nums ${row.netProfit >= 0 ? "text-pos" : "text-neg"}`}
      >
        {row.netRevenue > 0 ? `${row.margin.toFixed(1)}%` : "—"}
      </Td>
    </tr>
  );
}

/** The day-by-day profit sheet: the six columns, one row a day, a total underneath. */
export function DailyPnlTable({
  daily,
  totals,
  currency,
}: {
  daily: PnlDaily[];
  totals: PnlTotals;
  currency: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th align="right">Ads</Th>
            <Th align="right">COGS</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Fees</Th>
            <Th align="right">Profit</Th>
            <Th align="right">% Profit</Th>
          </tr>
        </thead>
        <tbody>
          {daily.map((row) => (
            <Row key={row.date} label={row.date} row={row} currency={currency} />
          ))}
          <Row label="Total" row={totals} currency={currency} strong />
        </tbody>
      </table>
    </div>
  );
}

/** The same sheet as CSV, for a spreadsheet. */
export function dailyPnlCsv(daily: PnlDaily[], totals: PnlTotals): string {
  const cells = (label: string, row: PnlTotals) => [
    label,
    row.adSpend.toFixed(2),
    totalCogs(row).toFixed(2),
    row.netRevenue.toFixed(2),
    totalFees(row).toFixed(2),
    row.netProfit.toFixed(2),
    row.netRevenue > 0 ? row.margin.toFixed(2) : "",
    costSource(row).label,
  ];
  return [
    ["Date", "Ads", "COGS", "Revenue", "Fees", "Profit", "% Profit", "COGS source"],
    ...daily.map((row) => cells(row.date, row)),
    cells("Total", totals),
  ]
    .map((line) => line.join(","))
    .join("\n");
}
