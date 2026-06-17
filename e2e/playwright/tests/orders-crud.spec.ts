import { test, expect } from "@playwright/test";

// Engine-backed (Phase 3 CRUD): inline-edit an order's quantity and delete an
// order on the Orders grid, asserting both persist through the DRF input API.
// Needs a computed plan (orders exist), so it's gated on the engine overlay.
// Mutates data; the CI stack is fresh per run.
test.skip(
  !process.env.E2E_ENGINE,
  "needs the engine overlay (docker-compose.engine.yml + E2E_ENGINE=1)",
);

test("Inline-edit an order quantity and persist it", async ({ page }) => {
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });

  // Enter edit mode on the first (editable) row.
  await firstRow.getByRole("button", { name: /^Edit / }).click();
  const qty = firstRow.getByLabel("Qty");
  await expect(qty).toBeVisible();
  await qty.fill("123");
  await firstRow.getByRole("button", { name: "Save" }).click();

  // Saved toast + the value persists after the reload.
  await expect(page.getByText(/Saved/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("tbody tr").first().getByText("123")).toBeVisible({
    timeout: 15_000,
  });
});

test("Delete an order with inline confirm", async ({ page }) => {
  await page.goto("/orders");
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const countBefore = await page.locator("tbody tr").count();

  await firstRow.getByRole("button", { name: /^Delete / }).click();
  await firstRow.getByRole("button", { name: "Yes" }).click();

  // Deleted toast + the reloaded grid has exactly one fewer row.
  await expect(page.getByText(/Deleted/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("tbody tr")).toHaveCount(countBefore - 1, {
    timeout: 15_000,
  });
});
