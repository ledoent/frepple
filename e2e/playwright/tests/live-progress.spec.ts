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

  // TaskProgressConsumer relays only *live* broadcasts - it sends no backlog on
  // connect (asgi.py) - so the feed starts empty and the only task that can show
  // up is the one this test just launched. The startup warmup plan
  // (FREPPLE_INIT_RUNPLAN) finished before page load, so it never appears here;
  // its job is purely to warm the engine so this launch reaches a terminal state
  // in seconds. A page-wide match is therefore unambiguous.
  await expect(page.getByText(/runplan/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Done|Failed/)).toBeVisible({ timeout: 90_000 });
});
