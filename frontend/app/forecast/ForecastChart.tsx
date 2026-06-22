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
    <div className="panel" style={{ marginTop: 18, padding: "18px 18px 8px" }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>
        Series chart — orders · baseline · net
      </div>
      <div style={{ height: 280 }} aria-label="forecast chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
          >
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" />
            <XAxis
              dataKey="bucket"
              stroke="var(--faint)"
              fontSize={11}
              tickLine={false}
            />
            <YAxis stroke="var(--faint)" fontSize={11} tickLine={false} />
            <Tooltip
              contentStyle={{
                background: "var(--raise)",
                border: "1px solid var(--line-bright)",
                borderRadius: 6,
                color: "var(--text)",
                fontSize: 12,
              }}
              cursor={{ stroke: "var(--line-bright)" }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="orders"
              stroke="var(--muted)"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="baseline"
              stroke="var(--signal)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="net"
              stroke="var(--ok)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
