"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { toChartRows, type ForecastSeries } from "@/lib/forecast";

// Orders / baseline / net over time for one series (Phase 1B-3).
export function ForecastChart({
  series,
  buckets,
}: {
  series: ForecastSeries;
  buckets: { name: string }[];
}) {
  const data = toChartRows(series, buckets);
  return (
    <div style={{ height: 280, marginTop: 16 }} aria-label="forecast chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="bucket" stroke="var(--muted)" fontSize={11} />
          <YAxis stroke="var(--muted)" fontSize={11} />
          <Tooltip
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
          <Legend />
          <Line type="monotone" dataKey="orders" stroke="#9aa0aa" dot={false} />
          <Line type="monotone" dataKey="baseline" stroke="#3b82f6" dot={false} />
          <Line type="monotone" dataKey="net" stroke="#22c55e" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
