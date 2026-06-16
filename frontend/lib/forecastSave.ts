import { getToken } from "./auth";
import { scenarioPrefix } from "./ws";
import {
  buildOverrideMessage,
  type ForecastSeries,
  type ForecastBucketMeta,
} from "./forecast";

// Persist one override edit: POST the ForecastService message to /forecast/detail/.
// The engine updates the override and re-nets; callers reload to pick up the new
// forecastnet. Returns nothing on success, throws on a non-2xx response.
export async function saveOverride(
  series: ForecastSeries,
  bucket: ForecastBucketMeta,
  value: number | null,
  scenario = "",
): Promise<void> {
  const token = await getToken();
  const res = await fetch(`${scenarioPrefix(scenario)}/forecast/detail/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(buildOverrideMessage(series, bucket, value)),
  });
  if (!res.ok) throw new Error(`forecast save failed: ${res.status}`);
}
