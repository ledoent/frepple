import { test, expect } from "@playwright/test";

// Engine-backed (D2): drag an editable operationplan bar on the pegging Gantt and
// confirm the reschedule round-trips - the drag -> PATCH /api/input/<type>/<ref>/
// -> persisted -> reload loop. Needs a computed plan, so it's gated on the engine
// overlay. Mutates data, but the CI stack is fresh per run (warmup plan only).
test.skip(
  !process.env.E2E_ENGINE,
  "needs the engine overlay (docker-compose.engine.yml + E2E_ENGINE=1)",
);

test("Dragging a bar reschedules the operationplan", async ({ page }) => {
  await page.goto("/pegging?demand=Demand%2001");
  const gantt = page.getByRole("table", { name: "Demand pegging Gantt" });
  await expect(gantt).toBeVisible({ timeout: 30_000 });

  // An editable bar (proposed MO/PO/etc - deliveries are zero-width, so prefer a
  // bar with real width by taking the first editable one and checking its box).
  const bar = page.locator(".gantt-bar--editable").first();
  await expect(bar).toBeVisible({ timeout: 30_000 });
  const box = await bar.boundingBox();
  if (!box) throw new Error("no editable bar box");

  // Drag it ~90px to the right via pointer (the bar uses pointer events).
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy, { steps: 8 });
  await page.mouse.up();

  // The PATCH succeeded -> a success toast, and the "peg is stale, re-plan" hint.
  await expect(page.getByText(/Rescheduled/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Re-plan now/i })).toBeVisible();
});
