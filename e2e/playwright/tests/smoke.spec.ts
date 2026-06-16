import { test, expect } from "@playwright/test";

// Verifies the screens we built against the running stack: the auth -> token ->
// websocket -> React path (Execute) and the enriched forecast read (Forecast).
// Engine-only flows (launch a real plan, override re-net) are out of scope here.

test("/api/token/ mints a JWT for the session user", async ({ request }) => {
  const res = await request.get("/api/token/");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(typeof body.token).toBe("string");
  expect(body.token.length).toBeGreaterThan(20);
});

test("Execute screen connects the task websocket", async ({ page }) => {
  await page.goto("/execute");
  await expect(page.getByRole("heading", { name: "Execute" })).toBeVisible();
  // The connection dot's title flips to "live" once ws/tasks/ is open - this
  // exercises token acquisition + the subprotocol-carried JWT + the consumer.
  await expect(page.locator('[title="live"]')).toBeVisible();
});

test("Forecast editor loads without error", async ({ page }) => {
  await page.goto("/forecast");
  await expect(page.getByRole("heading", { name: /Forecast/ })).toBeVisible();
  // Either the grid renders (one or more "Override" rows) or the empty-state
  // shows; both mean the enriched /api/output/forecast/ read + pivot worked
  // (no error). With real plan data the grid has many Override cells, so match
  // the first to stay out of strict-mode.
  await expect(
    page
      .locator("text=Override")
      .first()
      .or(page.locator("text=No forecast series.")),
  ).toBeVisible();
});
