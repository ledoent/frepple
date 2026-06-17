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

test("Pegging screen loads and lists demands", async ({ page }) => {
  await page.goto("/pegging");
  await expect(page.getByRole("heading", { name: "Demand pegging" })).toBeVisible();
  // The demand picker is populated from /api/input/demand/; selecting one and
  // the Gantt render is the engine-backed test. Here we only assert the picker
  // loaded (a demand option) or the no-match empty state - both mean the list
  // read worked without error.
  await expect(
    page
      .getByRole("option")
      .first()
      .or(page.getByText("NO DEMANDS MATCH")),
  ).toBeVisible();
});

test("Problems screen loads with tabs", async ({ page }) => {
  await page.goto("/problems");
  await expect(page.getByRole("heading", { name: "Problems" })).toBeVisible();
  // The Problems/Constraints tabs render; the list or empty-state both mean the
  // /api/output/problem/ read worked.
  await expect(page.getByRole("tab", { name: "Constraints" })).toBeVisible();
  await expect(
    page.getByText(/rows/).or(page.getByText(/NO PROBLEMS/)),
  ).toBeVisible();
});

test("Orders screen loads MO/PO/DO tabs", async ({ page }) => {
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Purchase" })).toBeVisible();
  await expect(
    page.getByText(/rows/).or(page.getByText(/NO ORDERS/)),
  ).toBeVisible();
});
