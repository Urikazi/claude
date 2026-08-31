"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ConversionDay } from "@/lib/conversion";

export type ChangeMarker = { date: string; title: string; index: number };

export function ConversionChart({
  data,
  markers,
  denominator,
  customersKnown,
}: {
  data: ConversionDay[];
  markers: ChangeMarker[];
  denominator: string;
  /** Without it the new-customer series is not drawn: it would be a flat zero, which
      reads as "no new customers converted" rather than "not measured". */
  customersKnown: boolean;
}) {
  // A day with no traffic yet is a gap, not a zero. Today's sessions arrive on the next
  // sync, and plotting the empty day as 0% draws a cliff to the floor that reads as a
  // collapse in conversion rather than as missing data.
  const points = data.map((day) => ({
    date: day.date.slice(5),
    full: day.date,
    newCvr: day.visits > 0 ? Number(day.newCvr.toFixed(3)) : null,
    cvr: day.visits > 0 ? Number(day.cvr.toFixed(3)) : null,
    visits: day.visits,
    orders: day.orders,
  }));
  const shown = new Set(points.map((point) => point.full));

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
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
            width={48}
            tickFormatter={(value: number) => `${value}%`}
          />
          <Tooltip
            contentStyle={{
              background: "#12151d",
              border: "1px solid #232838",
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: "#8d97ad" }}
            formatter={(value, name, item) => {
              if (value === null || value === undefined) return ["no data yet", String(name)];
              const row = item?.payload as (typeof points)[number] | undefined;
              const suffix = row ? ` · ${row.orders} of ${row.visits} ${denominator}` : "";
              return [`${Number(value).toFixed(2)}%${suffix}`, String(name)];
            }}
          />

          {/* Each change is drawn where it landed and numbered to its row in the table
              below; titles on the axis would overlap as soon as two land in a week. */}
          {markers
            .filter((marker) => shown.has(marker.date))
            .map((marker) => (
              <ReferenceLine
                key={marker.date + marker.index}
                x={marker.date.slice(5)}
                stroke="#8d97ad"
                strokeDasharray="3 3"
                label={{
                  value: String(marker.index),
                  position: "top",
                  fill: "#8d97ad",
                  fontSize: 10,
                }}
              />
            ))}

          {customersKnown ? (
            <Line
              type="monotone"
              dataKey="newCvr"
              name="New customer CVR"
              stroke="#3987e5"
              strokeWidth={2}
              dot={false}
            />
          ) : null}
          {/* Blended sits behind as context when new customers are known, and carries the
              chart on its own when they are not. */}
          <Line
            type="monotone"
            dataKey="cvr"
            name="Blended CVR"
            stroke={customersKnown ? "#8d97ad" : "#3987e5"}
            strokeWidth={customersKnown ? 1.5 : 2}
            strokeDasharray={customersKnown ? "4 3" : undefined}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
