"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PnlDaily } from "@/lib/pnl";
import { formatMoney } from "@/lib/format";

export function PnlChart({
  data,
  currency,
}: {
  data: PnlDaily[];
  currency: string;
}) {
  const points = data.map((day) => ({
    date: day.date.slice(5),
    revenue: day.netRevenue,
    adSpend: day.adSpend,
    profit: day.netProfit,
  }));

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b8cff" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#5b8cff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#232838" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="#8d97ad"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#232838" }}
            minTickGap={16}
          />
          <YAxis
            stroke="#8d97ad"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(value: number) => formatMoney(value, currency)}
          />
          <Tooltip
            contentStyle={{
              background: "#12151d",
              border: "1px solid #232838",
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: "#8d97ad" }}
            formatter={(value, name) => [formatMoney(Number(value) || 0, currency), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#8d97ad" }} />
          <Area
            type="monotone"
            dataKey="revenue"
            name="Net revenue"
            stroke="#5b8cff"
            strokeWidth={2}
            fill="url(#revenueFill)"
          />
          <Bar dataKey="adSpend" name="Ad spend" fill="#f59e0b" radius={[3, 3, 0, 0]} barSize={14} />
          <Line
            type="monotone"
            dataKey="profit"
            name="Net profit"
            stroke="#34d399"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
