import { test, expect } from "@playwright/test";

// Engine-backed (D3): after a reschedule, the affected downstream chain is
// highlighted and a "Re-plan now" button appears; clicking it runs the engine
// (runplan), waits for it over the task websocket, and refreshes the peg. Needs
// the engine overlay (real runplan + ws). Mutates data; the CI stack is fresh.
test.skip(
  !process.env.E2E_ENGINE,
  "needs the engine overlay (docker-compose.engine.yml + E2E_ENGINE=1)",
);

test("Reschedule flags downstream + re-plan refreshes in place", async ({ page }) => {
  await page.goto("/pegging?demand=Demand%2001");
  const gantt = page.getByRole("table", { name: "Demand pegging Gantt" });
  await expect(gantt).toBeVisible({ timeout: 30_000 });

  // Drag an editable bar ~90px to reschedule it (reuses the D2 gesture).
  const bar = page.locator(".gantt-bar--editable").first();
  await expect(bar).toBeVisible({ timeout: 30_000 });
  const box = await bar.boundingBox();
  if (!box) throw new Error("no editable bar box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  // D3: the reschedule flags the downstream chain + offers an in-place re-plan.
  await expect(page.getByText(/Highlighted steps may shift/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".gantt-row--affected").first()).toBeVisible();
  const replanBtn = page.getByRole("button", { name: /Re-plan now/i });
  await expect(replanBtn).toBeVisible();

  // Run the engine in place; the loop watches the task ws to completion.
  await replanBtn.click();
  await expect(page.getByText(/Re-planned/i)).toBeVisible({ timeout: 90_000 });
  // The stale banner clears once the peg is refreshed.
  await expect(page.getByText(/Highlighted steps may shift/i)).toBeHidden();
});
