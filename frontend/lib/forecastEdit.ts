// Pure forecast-edit helpers (Phase 1B-3): bulk operations on a row of override
// values and outlier detection. Kept free of React/DOM so they are unit-tested
// directly (forecastEdit.test.ts).

function round(n: number): number {
  // Forecast quantities are whole-ish; keep 3 decimals to avoid fp noise.
  return Math.round(n * 1000) / 1000;
}

// Fill every slot with one value (bulk "set").
export function applyFill(value: number | null, count: number): (number | null)[] {
  return Array.from({ length: count }, () => value);
}

// Scale each non-null value by a percentage: +10 -> x1.1, -5 -> x0.95.
export function applyPercent(
  values: (number | null)[],
  pct: number,
): (number | null)[] {
  const factor = 1 + pct / 100;
  return values.map((v) => (v == null ? null : round(v * factor)));
}

// Copy the first non-null value across the whole row (bulk "fill right").
export function applyCopyFirst(values: (number | null)[]): (number | null)[] {
  const first = values.find((v) => v != null);
  const v = first == null ? null : first;
  return values.map(() => v);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

// Flag outliers using the Tukey IQR rule (robust to non-normal demand). Needs at
// least 4 points; otherwise nothing is flagged. Nulls are never outliers.
export function detectOutliers(values: (number | null)[]): boolean[] {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 4) return values.map(() => false);
  const sorted = [...nums].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return values.map((v) => v != null && (v < lo || v > hi));
}
