import { expect, type Page, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

/** The tabular rows live in the table layout; `layout=list` is Kaneo's grouped list. */
const WORK_TABLE_PATH = "/agent/projects/WLP/work?layout=table";
// Over 100 rows the table is row-virtualized (`work-item-table.tsx`): only a window of rows is
// in the DOM and keyboard focus is carried across the window boundary. The `content-visibility`
// contract applies to the full (100 rows or fewer) table, which this 500-row fixture does not
// render.
const VIRTUAL_TABLE =
  "[data-testid=work-item-list-populated][data-virtualized-table=true]";

async function rowGeometry(page: Page) {
  return page.evaluate((selector) => {
    const table = document.querySelector<HTMLTableElement>(selector);
    const rows = Array.from(
      table?.querySelectorAll<HTMLTableRowElement>(
        "tbody tr[data-virtual-row-id]",
      ) ?? [],
    );
    const first = rows[0];
    const last = rows.at(-1);
    if (!table || !first || !last)
      throw new Error("Expected the virtualized work table with rows.");
    const focusedRow = (document.activeElement as HTMLElement | null)?.closest(
      "tr[data-virtual-row-id]",
    );
    const rect = focusedRow?.getBoundingClientRect();
    return {
      renderedRows: rows.length,
      firstRowHeight: first.getBoundingClientRect().height,
      lastRowHeight: last.getBoundingClientRect().height,
      tableHeight: table.getBoundingClientRect().height,
      focusedKey: focusedRow
        ?.querySelector<HTMLElement>("a[data-work-item-key]")
        ?.getAttribute("data-work-item-key"),
      focusedVisible: rect
        ? rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0
        : false,
    };
  }, VIRTUAL_TABLE);
}

/** The key of the last row currently in the DOM window. */
async function lastRenderedKey(page: Page) {
  return page
    .locator(`${VIRTUAL_TABLE} tbody tr[data-virtual-row-id]`)
    .last()
    .locator("a[data-work-item-key]")
    .first()
    .getAttribute("data-work-item-key");
}

/**
 * Tab row by row from the first row past the last row of the initial DOM window: the next row
 * was not mounted, and focus must reach it (mounted on demand) without leaving the table,
 * skipping a row or moving backwards.
 */
async function tabPastWindow(page: Page) {
  const startKey = await lastRenderedKey(page);
  if (!startKey) throw new Error("Expected a rendered row key.");
  const startNumber = Number(startKey.split("-")[1]);
  const nextKey = `WLP-${startNumber + 1}`;
  await expect(
    page.locator(`${VIRTUAL_TABLE} a[data-work-item-key="${nextKey}"]`),
  ).toHaveCount(0);
  await expect(async () => {
    await page
      .locator(`${VIRTUAL_TABLE} a[data-work-item-key="WLP-1"]`)
      .first()
      .focus();
    expect((await rowGeometry(page)).focusedKey).toBe("WLP-1");
  }).toPass();
  const visited = [(await rowGeometry(page)).focusedKey];
  for (let step = 0; step < 20 * (startNumber + 1); step++) {
    await page.keyboard.press("Tab");
    const key = (await rowGeometry(page)).focusedKey;
    if (key !== visited.at(-1)) visited.push(key);
    if (key === nextKey || key === undefined) break;
  }
  return { startKey, nextKey, visited, after: await rowGeometry(page) };
}

/** Scroll the table's scroll parent to its end and focus the terminal row's last link. */
async function focusTerminalRow(page: Page) {
  const terminalLinks = page.locator(
    `${VIRTUAL_TABLE} a[data-work-item-key="WLP-500"]`,
  );
  // Rows are measured as they mount, so the end can move; keep scrolling like a user would.
  await expect(async () => {
    await page.evaluate((selector) => {
      let current = document.querySelector(selector)?.parentElement ?? null;
      while (current) {
        const overflow = getComputedStyle(current).overflowY;
        if (
          (overflow === "auto" || overflow === "scroll") &&
          current.scrollHeight > current.clientHeight
        ) {
          current.scrollTop = current.scrollHeight;
          return;
        }
        current = current.parentElement;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
    }, VIRTUAL_TABLE);
    await terminalLinks.last().focus({ timeout: 500 });
    expect(
      await page.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.dataset.workItemKey,
      ),
    ).toBe("WLP-500");
  }).toPass({ timeout: 10_000 });
}

test("all 500 virtualized work rows keep their geometry and keyboard reachability", async ({
  page,
}, testInfo) => {
  // Tabbing row by row through the initial window is a long keyboard journey.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  await page.goto(WORK_TABLE_PATH);

  const table = page.locator(VIRTUAL_TABLE);
  await expect(table).toBeVisible();
  await expect(
    table.locator("tbody tr[data-virtual-row-id]").first(),
  ).toBeVisible();

  // Measure the settled table: rows first paint at a shorter height and grow once their
  // property controls and web fonts are in, so wait until two samples agree.
  let settledHeight = -1;
  await expect(async () => {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const height = (await rowGeometry(page)).tableHeight;
    const previous = settledHeight;
    settledHeight = height;
    expect(height).toBe(previous);
  }).toPass({ intervals: [250] });
  // Bounded DOM: a window of the 500 rows, not all of them.
  const before = await rowGeometry(page);
  expect(before.renderedRows).toBeGreaterThan(0);
  expect(before.renderedRows).toBeLessThan(100);
  expect(before.lastRowHeight).toBeGreaterThan(0);
  expect(Math.abs(before.firstRowHeight - before.lastRowHeight)).toBeLessThan(
    1,
  );

  // Keyboard focus crosses the window boundary into a row that was not mounted.
  const crossing = await tabPastWindow(page);
  // Every row in order, one at a time, and the first unmounted row last.
  expect(crossing.visited).toEqual(
    Array.from(
      { length: Number(crossing.nextKey.split("-")[1]) },
      (_, index) => `WLP-${index + 1}`,
    ),
  );
  expect(crossing.after.focusedKey).toBe(crossing.nextKey);
  expect(crossing.after.focusedVisible).toBe(true);
  expect(
    Math.abs(crossing.after.firstRowHeight - crossing.after.lastRowHeight),
  ).toBeLessThan(1);
  // No layout shift: the table's height does not change as focus moves below the window.
  expect
    .soft(Math.abs(crossing.after.tableHeight - before.tableHeight))
    .toBeLessThan(2);

  // The terminal row is reachable and keeps focus and visibility.
  await focusTerminalRow(page);
  await page.keyboard.press("Shift+Tab");
  const afterFocus = await rowGeometry(page);
  expect(afterFocus.focusedKey).toBe("WLP-500");
  expect(afterFocus.focusedVisible).toBe(true);
  expect(
    Math.abs(afterFocus.firstRowHeight - afterFocus.lastRowHeight),
  ).toBeLessThan(1);
  expect
    .soft(Math.abs(afterFocus.tableHeight - before.tableHeight))
    .toBeLessThan(2);

  // 200% zoom: rows scale, stay uniform, and the terminal row stays reachable.
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await focusTerminalRow(page);
  await page.keyboard.press("Shift+Tab");
  const zoomedGeometry = await rowGeometry(page);
  console.info(
    "Virtualized work table geometry",
    JSON.stringify({ before, crossing, afterFocus, zoomedGeometry }),
  );
  expect(zoomedGeometry.focusedKey).toBe("WLP-500");
  expect(zoomedGeometry.focusedVisible).toBe(true);
  expect(
    Math.abs(zoomedGeometry.firstRowHeight - zoomedGeometry.lastRowHeight),
  ).toBeLessThan(2);
  expect(
    Math.abs(zoomedGeometry.firstRowHeight - 2 * before.firstRowHeight),
  ).toBeLessThan(2);

  await page.screenshot({
    path: testInfo.outputPath("work-item-list-virtualized-last-row.png"),
  });
});
