import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// Every key path of the English catalogue, with and without its namespace. i18next returns the
// key (without the namespace) when it cannot resolve one, so a screen showing any of these as
// its own text, label, title or placeholder is showing a raw key, dotted or not.
function catalogueKeyPaths() {
  const catalogue = JSON.parse(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../i18n/en-US.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const paths = new Set<string>();
  const walk = (node: unknown, prefix: string, namespace: string) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node))
        walk(value, prefix ? `${prefix}.${key}` : key, namespace);
      return;
    }
    // A one-word path ("new") is ordinary copy in places; its namespaced form is not.
    if (prefix.includes(".") || /[a-z][A-Z]/.test(prefix)) paths.add(prefix);
    paths.add(`${namespace}:${prefix}`);
    // The bare last segment is also what a missing key renders ("loadFailed"). Single plain
    // words ("new", "title") are not tracked: they are ordinary copy in places, so only
    // camelCase leaves, which no screen prints as text, are a reliable signal.
    const leaf = prefix.split(".").pop() ?? prefix;
    if (/[a-z][A-Z]/.test(leaf)) paths.add(leaf);
  };
  for (const [namespace, value] of Object.entries(catalogue))
    walk(value, "", namespace);
  return [...paths];
}

const KEY_PATHS = catalogueKeyPaths();

async function rawKeys(page: Page) {
  const shown = await page.evaluate((keyPaths) => {
    const keys = new Set(keyPaths);
    const found = new Set<string>();
    const check = (value: string | null | undefined) => {
      const text = value?.trim();
      if (text && keys.has(text)) found.add(text);
    };
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      for (const node of Array.from(element.childNodes))
        if (node.nodeType === Node.TEXT_NODE) check(node.textContent);
      for (const name of ["aria-label", "title", "placeholder", "alt"])
        check(element.getAttribute(name));
    }
    return [...found];
  }, KEY_PATHS);
  const text = await page.evaluate(() => document.body.innerText);
  const dotted = (text.match(RAW_KEY) ?? []).filter(
    (token) => !/^(www|e\.g|i\.e)/.test(token),
  );
  return [...new Set([...shown, ...dotted])];
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
