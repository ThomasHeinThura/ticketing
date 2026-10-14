import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

// A direct visit to the work list loads only the namespaces it paints with and fetches the rest
// after first paint (G11). These specs hold or fail that second fetch and assert that no screen
// ever shows a raw `namespace:key` / `dotted.key` string instead of copy.

const RAW_KEY =
  /(?<![\w@/.-])[a-z][A-Za-z0-9]*(?:\.[a-zA-Z][A-Za-z0-9]*){1,5}(?![\w@-])/g;

async function rawKeys(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  return [
    ...new Set(
      (text.match(RAW_KEY) ?? []).filter(
        (token) => !/^(www|e\.g|i\.e)/.test(token),
      ),
    ),
  ];
}

async function holdDeferredGroup(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/rest-[A-Za-z-]+-[\w-]+\.js/, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

async function navigateInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
});

test("the work list shows no raw keys while the deferred namespaces are held", async ({
  page,
}) => {
  const release = await holdDeferredGroup(page);
  await page.goto(WORK_LIST_PATH);
  await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Work items",
  );
  await page.waitForTimeout(1_000);
  expect(await rawKeys(page)).toEqual([]);
  release();
});

test("opening a work item while the deferred namespaces are held waits for them, then shows no raw keys", async ({
  page,
}) => {
  const release = await holdDeferredGroup(page);
  await page.goto(WORK_LIST_PATH);
  await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
  await page
    .locator("[data-testid=work-item-list-populated] tbody tr a")
    .first()
    .click();
  await page.waitForTimeout(1_000);
  // Still on the list: navigation is gated on the catalog, not rendered with raw keys.
  expect(await rawKeys(page)).toEqual([]);
  release();
  await expect(page).toHaveURL(/\/agent\/work-items\/WLP-1/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(await rawKeys(page)).toEqual([]);
});

for (const target of ["/agent/triage", "/agent/settings/calendars"]) {
  test(`navigating to ${target} while the deferred namespaces are held shows no raw keys`, async ({
    page,
  }) => {
    const release = await holdDeferredGroup(page);
    await page.goto(WORK_LIST_PATH);
    await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
    await navigateInApp(page, target);
    await page.waitForTimeout(1_000);
    expect(await rawKeys(page)).toEqual([]);
    release();
    await expect(page).toHaveURL(new RegExp(target));
    await page.waitForTimeout(1_000);
    expect(await rawKeys(page)).toEqual([]);
  });
}

test("a failed deferred fetch falls back to the full catalog instead of raw keys", async ({
  page,
}) => {
  await page.route(/\/assets\/rest-[A-Za-z-]+-[\w-]+\.js/, (route) =>
    route.abort(),
  );
  await page.goto(WORK_LIST_PATH);
  await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(await rawKeys(page)).toEqual([]);
  await page
    .locator("[data-testid=work-item-list-populated] tbody tr a")
    .first()
    .click();
  await expect(page).toHaveURL(/\/agent\/work-items\/WLP-1/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(await rawKeys(page)).toEqual([]);
});

test("when the deferred group and the full catalog both fail, an error is shown instead of raw keys", async ({
  page,
}) => {
  await page.route(/\/assets\/rest-[A-Za-z-]+-[\w-]+\.js/, (route) =>
    route.abort(),
  );
  await page.route(/\/assets\/en-US-[\w-]+\.js/, (route) => route.abort());
  await page.goto(WORK_LIST_PATH);
  await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
  await page
    .locator("[data-testid=work-item-list-populated] tbody tr a")
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  expect(await rawKeys(page)).toEqual([]);
});
