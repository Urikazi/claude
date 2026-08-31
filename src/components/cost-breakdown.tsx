"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney, formatPercent } from "@/lib/format";

export type CostSlice = { label: string; value: number };

/**
 * Slot order is fixed, so a cost keeps its colour when another falls to zero and
 * drops out. Colour follows the category, never its rank.
 */
const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
];

export function CostBreakdown({
  slices,
  currency,
}: {
  slices: CostSlice[];
  currency: string;
}) {
  const coloured = slices.map((slice, index) => ({
    ...slice,
    fill: SERIES[index % SERIES.length],
  }));
  const total = coloured.reduce((sum, slice) => sum + slice.value, 0);
  const shown = coloured.filter((slice) => slice.value > 0);

  if (total <= 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        No costs in this range yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              // A surface-coloured gap keeps adjacent segments legible without a stroke.
              paddingAngle={2}
              stroke="var(--panel)"
              strokeWidth={2}
            >
              {shown.map((slice) => (
                <Cell key={slice.label} fill={slice.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--text)",
              }}
              formatter={(value, name) => {
                const amount = Number(value);
                return [
                  `${formatMoney(amount, currency)} · ${formatPercent((amount / total) * 100)}`,
                  String(name),
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-muted">Total costs</span>
          <span className="text-base font-semibold tabular-nums">
            {formatMoney(total, currency)}
          </span>
        </div>
      </div>

      {/* One row per cost rather than a grid: in a half-width card two columns force
          "Cost of goods" onto three lines. Values are listed rather than labelled on
          the arcs, where a thin slice's label collides with its neighbour. */}
      <ul className="w-full flex-1 space-y-2">
        {coloured.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: slice.fill }}
            />
            <span className="flex-1 truncate text-muted">{slice.label}</span>
            <span className="shrink-0 tabular-nums">{formatMoney(slice.value, currency)}</span>
            <span className="w-12 shrink-0 text-right tabular-nums text-muted">
              {total > 0 ? formatPercent((slice.value / total) * 100) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
