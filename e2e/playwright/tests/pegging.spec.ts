import { test, expect } from "@playwright/test";

// Engine-backed: pick a planned demand and confirm its pegging Gantt renders the
// supply-chain tree (rows + bars) on a dated axis - proving the enriched
// /api/output/pegging/<demand>/ read (window header + tree) + the SVG-less Gantt
// geometry end-to-end. Needs a computed plan, so it's gated on the engine overlay.
test.skip(
  !process.env.E2E_ENGINE,
  "needs the engine overlay (docker-compose.engine.yml + E2E_ENGINE=1)",
);

test("Demand pegging Gantt renders a supply-chain trace", async ({ page }) => {
  await page.goto("/pegging?demand=Demand%2001");
  await expect(page.getByRole("heading", { name: "Demand pegging" })).toBeVisible();

  // The Gantt appears once the pegging read resolves, and carries at least one
  // tree row with a bar (the demo "Demand 01" is planned with pegging).
  const gantt = page.getByRole("table", { name: "Demand pegging Gantt" });
  await expect(gantt).toBeVisible({ timeout: 30_000 });
  await expect(gantt.locator(".gantt-bar").first()).toBeVisible({
    timeout: 30_000,
  });

  // The delivery step (depth 1) is a DLVR row - the root of the peg.
  await expect(gantt.getByText("DLVR").first()).toBeVisible();
});
