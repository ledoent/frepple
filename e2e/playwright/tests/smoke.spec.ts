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

test("Inventory report loads without error", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  // Either buffers render (a measure label) or the empty-state shows; both mean
  // the enriched /api/output/inventory/ read + generic pivot parse worked.
  await expect(
    page
      .getByText("Start OH")
      .first()
      .or(page.getByText("No inventory buffers.")),
  ).toBeVisible();
});

test("Demand report loads without error", async ({ page }) => {
  await page.goto("/demand");
  await expect(page.getByRole("heading", { name: "Demand" })).toBeVisible();
  // The grid caption (unique) or the empty state - both mean the enriched
  // /api/output/demand/ read + generic pivot parse worked.
  await expect(
    page.getByText(/Demand by series over/).or(page.getByText("No demand series.")),
  ).toBeVisible();
});

test("Resource report loads without error", async ({ page }) => {
  await page.goto("/resource");
  await expect(page.getByRole("heading", { name: "Resource" })).toBeVisible();
  await expect(
    page.getByText(/Resource by series over/).or(page.getByText("No resources.")),
  ).toBeVisible();
});
