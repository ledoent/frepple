import { authedFetch } from "./api";
import { HttpError } from "./errors";
import { scenarioPrefix } from "./ws";
import {
  buildOverrideMessage,
  buildBulkOverrideMessage,
  type OverrideMessage,
  type ForecastSeries,
  type ForecastBucketMeta,
} from "./forecast";

async function post(message: OverrideMessage, scenario: string): Promise<void> {
  const res = await authedFetch(`${scenarioPrefix(scenario)}/forecast/detail/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok)
    throw new HttpError(res.status, `forecast save failed: ${res.status}`);
}

// Persist one override edit. The engine updates the override and re-nets; callers
// reload to pick up the new forecastnet.
export async function saveOverride(
  series: ForecastSeries,
  bucket: ForecastBucketMeta,
  value: number | null,
  scenario = "",
): Promise<void> {
  await post(buildOverrideMessage(series, bucket, value), scenario);
}

// Persist a bulk edit (fill / +-% across a row) in a single request.
export async function saveBulkOverrides(
  series: ForecastSeries,
  edits: { bucket: ForecastBucketMeta; value: number | null }[],
  scenario = "",
): Promise<void> {
  if (edits.length === 0) return;
  await post(buildBulkOverrideMessage(series, edits), scenario);
}
