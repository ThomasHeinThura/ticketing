import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

function intrinsicSizeInPixels(value: string) {
  const match = value.match(/([\d.]+)px$/);
  return Number.parseFloat(match?.[1] ?? "NaN");
}

test("all 500 content-visible work rows keep their geometry and keyboard reachability", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  await page.goto(WORK_LIST_PATH);

  const rows = page.locator("[data-testid=work-item-list-populated] tbody tr");
  const links = page.locator(
    "[data-testid=work-item-list-populated] a[data-work-item-key]",
  );
  await expect(rows).toHaveCount(500);
  await expect(links).toHaveCount(1_000);

  const beforeFocus = await page.evaluate(() => {
    const table = document.querySelector<HTMLTableElement>(
      '[data-testid="work-item-list-populated"]',
    );
    const firstRow = table?.tBodies[0]?.rows.item(0);
    const lastRow = table?.tBodies[0]?.rows.item(499);
    const lastCellContent = lastRow?.querySelector<HTMLElement>(
      ".work-item-list-cell-content",
    );
    if (!table || !firstRow || !lastRow || !lastCellContent)
      throw new Error("Expected the complete 500-row work list.");
    return {
      firstRowHeight: firstRow.getBoundingClientRect().height,
      lastRowHeight: lastRow.getBoundingClientRect().height,
      tableHeight: table.getBoundingClientRect().height,
      contentVisibility: getComputedStyle(lastCellContent).contentVisibility,
      intrinsicBlockSize:
        getComputedStyle(lastCellContent).containIntrinsicBlockSize,
    };
  });

  const offscreenRow = rows.nth(250);
  await offscreenRow.evaluate((row) => {
    for (const content of row.querySelectorAll<HTMLElement>(
      ".work-item-list-cell-content",
    )) {
      content.style.containIntrinsicBlockSize = "auto 100px";
    }
  });
  const inflatedTableHeight = await page
    .getByTestId("work-item-list-populated")
    .evaluate((table) => table.getBoundingClientRect().height);
  await offscreenRow.evaluate((row) => {
    for (const content of row.querySelectorAll<HTMLElement>(
      ".work-item-list-cell-content",
    )) {
      content.style.containIntrinsicBlockSize = "";
    }
  });
  const restoredTableHeight = await page
    .getByTestId("work-item-list-populated")
    .evaluate((table) => table.getBoundingClientRect().height);
  expect(inflatedTableHeight - beforeFocus.tableHeight).toBeGreaterThan(40);
  expect(Math.abs(restoredTableHeight - beforeFocus.tableHeight)).toBeLessThan(
    2,
  );

  await links.last().focus();
  const focusedTerminalLink = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset.workItemKey,
  );
  await page.keyboard.press("Shift+Tab");

  const afterFocus = await page.evaluate(() => {
    const table = document.querySelector<HTMLTableElement>(
      '[data-testid="work-item-list-populated"]',
    );
    const firstRow = table?.tBodies[0]?.rows.item(0);
    const lastRow = table?.tBodies[0]?.rows.item(499);
    if (!firstRow || !lastRow)
      throw new Error("Expected the complete 500-row work list.");
    const rect = lastRow.getBoundingClientRect();
    return {
      firstRowHeight: firstRow.getBoundingClientRect().height,
      lastRowHeight: rect.height,
      tableHeight: table.getBoundingClientRect().height,
      lastRowVisible:
        rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0,
      focusedKey: (document.activeElement as HTMLElement | null)?.dataset
        .workItemKey,
    };
  });

  expect(beforeFocus.contentVisibility).toBe("auto");
  expect(beforeFocus.intrinsicBlockSize).not.toBe("none");
  expect(beforeFocus.lastRowHeight).toBeGreaterThan(0);
  expect(
    Math.abs(intrinsicSizeInPixels(beforeFocus.intrinsicBlockSize) - 18),
  ).toBeLessThan(1);
  expect(afterFocus.lastRowVisible).toBe(true);
  expect(focusedTerminalLink).toBe("WLP-500");
  expect(afterFocus.focusedKey).toBe("WLP-500");
  expect(
    Math.abs(afterFocus.firstRowHeight - afterFocus.lastRowHeight),
  ).toBeLessThan(1);
  expect(
    Math.abs(afterFocus.tableHeight - beforeFocus.tableHeight),
  ).toBeLessThan(2);

  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const zoomedTableHeightBeforeFocus = await page
    .getByTestId("work-item-list-populated")
    .evaluate((table) => table.getBoundingClientRect().height);
  await links.last().focus();
  await page.keyboard.press("Shift+Tab");
  const zoomedGeometry = await page.evaluate(() => {
    const table = document.querySelector<HTMLTableElement>(
      '[data-testid="work-item-list-populated"]',
    );
    const firstRow = table?.tBodies[0]?.rows.item(0);
    const lastRow = table?.tBodies[0]?.rows.item(499);
    if (!firstRow || !lastRow)
      throw new Error("Expected all work rows at 200% zoom.");
    const rect = lastRow.getBoundingClientRect();
    return {
      firstRowHeight: firstRow.getBoundingClientRect().height,
      lastRowHeight: rect.height,
      tableHeight: table.getBoundingClientRect().height,
      visible:
        rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0,
      focusedKey: (document.activeElement as HTMLElement | null)?.dataset
        .workItemKey,
    };
  });
  console.info(
    "Work list content-visibility geometry",
    JSON.stringify({
      beforeFocus,
      offscreenIntrinsicProbe: {
        baselineTableHeight: beforeFocus.tableHeight,
        inflatedTableHeight,
        restoredTableHeight,
      },
      afterFocus,
      zoomedGeometry,
    }),
  );
  expect(zoomedGeometry.visible).toBe(true);
  expect(zoomedGeometry.focusedKey).toBe("WLP-500");
  expect(
    Math.abs(zoomedGeometry.firstRowHeight - zoomedGeometry.lastRowHeight),
  ).toBeLessThan(2);
  expect(
    Math.abs(zoomedGeometry.firstRowHeight - 2 * beforeFocus.firstRowHeight),
  ).toBeLessThan(2);
  expect(
    Math.abs(zoomedGeometry.tableHeight - zoomedTableHeightBeforeFocus),
  ).toBeLessThan(4);

  await page.screenshot({
    path: testInfo.outputPath("work-item-list-content-visible-last-row.png"),
  });
});
