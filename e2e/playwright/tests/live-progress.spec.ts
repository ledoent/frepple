import { test, expect } from "@playwright/test";

// Engine-backed flow: launch a real plan from the Execute screen and watch its
// progress advance over the websocket to a terminal state - proving the full
// runplan -> Task.status -> Redis broadcast -> ws/tasks/ -> React loop. Only
// meaningful with the engine overlay, so it is skipped otherwise.
test.skip(
  !process.env.E2E_ENGINE,
  "needs the engine overlay (docker-compose.engine.yml + E2E_ENGINE=1)",
);

test("Run plan streams live progress to a terminal state", async ({ page }) => {
  await page.goto("/execute");
  await expect(page.locator('[title="live"]')).toBeVisible();

  await page.getByRole("button", { name: /Run plan/ }).click();

  // The launched task appears and advances to a terminal status. A demo plan
  // runs in seconds; allow generous time for the engine + broadcast round-trip.
  await expect(page.getByText(/runplan/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Done|Failed/)).toBeVisible({ timeout: 90_000 });
});
