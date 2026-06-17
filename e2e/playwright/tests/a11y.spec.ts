import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Accessibility gate (fc-a11y): the new screens must have zero CRITICAL axe
// violations. Run against the live stack so the rendered DOM (grid, inputs,
// chart) is scanned, not just markup.

async function criticalViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter((v) => v.impact === "critical");
}

test("Forecast editor: 0 critical a11y violations", async ({ page }) => {
  await page.goto("/forecast");
  await expect(page.getByRole("heading", { name: /Forecast/ })).toBeVisible();
  const critical = await criticalViolations(page);
  expect(critical, JSON.stringify(critical.map((v) => v.id))).toEqual([]);
});

test("Execute screen: 0 critical a11y violations", async ({ page }) => {
  await page.goto("/execute");
  await expect(page.getByRole("heading", { name: "Execute" })).toBeVisible();
  const critical = await criticalViolations(page);
  expect(critical, JSON.stringify(critical.map((v) => v.id))).toEqual([]);
});

test("Inventory report: 0 critical a11y violations", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  const critical = await criticalViolations(page);
  expect(critical, JSON.stringify(critical.map((v) => v.id))).toEqual([]);
});

test("Demand report: 0 critical a11y violations", async ({ page }) => {
  await page.goto("/demand");
  await expect(page.getByRole("heading", { name: "Demand" })).toBeVisible();
  const critical = await criticalViolations(page);
  expect(critical, JSON.stringify(critical.map((v) => v.id))).toEqual([]);
});

test("Resource report: 0 critical a11y violations", async ({ page }) => {
  await page.goto("/resource");
  await expect(page.getByRole("heading", { name: "Resource" })).toBeVisible();
  const critical = await criticalViolations(page);
  expect(critical, JSON.stringify(critical.map((v) => v.id))).toEqual([]);
});
