import { expect, type Page, test } from "@playwright/test";
import {
  installLastItemPaintRecorderInDocument,
  type LastItemPaintRecorderOptions,
} from "./helpers/last-item-paint-recorder";

const LIST_OPTIONS: LastItemPaintRecorderOptions = {
  kind: "list",
  expectedCount: 500,
  metric: "listPaint",
};
const BOARD_OPTIONS: LastItemPaintRecorderOptions = {
  kind: "board",
  expectedCount: 200,
  metric: "boardPaint",
};

function listMarkup(count = 500, targetStyle = "") {
  const rows = Array.from(
    { length: count },
    (_, index) => `<tr><td>Work item ${index + 1}</td></tr>`,
  ).join("");
  return `<table data-testid="work-item-list-populated"><tbody style="${targetStyle}">${rows}</tbody></table>`;
}

function boardMarkup(
  idForIndex: (index: number) => string = (index) => `legacy-task-${index}`,
  targetStyle = "",
  count = 200,
) {
  const cards = Array.from(
    { length: count },
    (_, offset) =>
      `<article class="card" data-task-id="${idForIndex(offset + 1)}" style="${offset === 199 ? targetStyle : ""}">Card ${offset + 1}</article>`,
  ).join("");
  return `<main id="board">${cards}</main>`;
}

async function mountFixture(page: Page, html: string) {
  await page.setContent(
    `<style>
      html, body { margin: 0; min-height: 100%; }
      table { border-collapse: collapse; }
      tr { height: 28px; }
      .card { display: block; height: 28px; }
    </style>${html}`,
  );
  await page.evaluate(() => {
    (
      window as Window & { __g11Metrics?: Record<string, number> }
    ).__g11Metrics = {
      listPaint: 0,
      boardPaint: 0,
    };
  });
}

async function install(page: Page, options: LastItemPaintRecorderOptions) {
  await page.evaluate(installLastItemPaintRecorderInDocument, options);
}

async function mutateOnFirstAnimationFrame(
  page: Page,
  action: "replace-list-body" | "replace-board-card" | "reparent-board-card",
) {
  await page.evaluate((mutation) => {
    const nativeRequestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    let changed = false;
    window.requestAnimationFrame = (callback) =>
      nativeRequestAnimationFrame((timestamp) => {
        if (!changed) {
          changed = true;
          if (mutation === "replace-list-body") {
            const body = document.querySelector(
              '[data-testid="work-item-list-populated"] tbody',
            );
            if (!body) throw new Error("Expected the rendered table body.");
            body.replaceWith(body.cloneNode(true));
          } else {
            const target = document.querySelector(
              '[data-task-id="legacy-task-200"]',
            );
            if (!target)
              throw new Error("Expected the terminal rendered card.");
            if (mutation === "replace-board-card") {
              target.replaceWith(target.cloneNode(true));
            } else {
              const column = document.querySelector("#other-column");
              if (!column)
                throw new Error("Expected the destination board column.");
              column.append(target);
            }
          }
        }
        callback(timestamp);
      });
  }, action);
}

async function expectNoMark(page: Page, metric: string) {
  await page.waitForTimeout(120);
  expect(
    await page.evaluate(
      (name) =>
        (window as Window & { __g11Metrics?: Record<string, number> })
          .__g11Metrics?.[name] ?? 0,
      metric,
    ),
  ).toBe(0);
}

async function waitForMark(page: Page, metric: string) {
  await page.waitForFunction(
    (name) =>
      ((window as Window & { __g11Metrics?: Record<string, number> })
        .__g11Metrics?.[name] ?? 0) > 0,
    metric,
    { timeout: 2_000 },
  );
}

test.describe("G11 last-item paint recorder in Chromium", () => {
  test("keeps 500 real rows, scrolls the terminal row once, and marks after two frames", async ({
    page,
  }) => {
    await mountFixture(page, listMarkup());
    await page.evaluate(() => {
      const original = Element.prototype.scrollIntoView;
      const state = window as Window & { __scrollCalls?: number };
      state.__scrollCalls = 0;
      Element.prototype.scrollIntoView = function (...args) {
        state.__scrollCalls = (state.__scrollCalls ?? 0) + 1;
        return original.apply(this, args);
      };
    });
    await install(page, LIST_OPTIONS);
    await waitForMark(page, "listPaint");

    const evidence = await page.evaluate(() => {
      const body = document.querySelector<HTMLTableSectionElement>(
        '[data-testid="work-item-list-populated"] tbody',
      );
      const target = body?.rows.item(499);
      const rect = target?.getBoundingClientRect();
      return {
        rowCount: body?.rows.length,
        targetText: target?.textContent,
        connected: Boolean(target?.isConnected),
        rect: rect
          ? {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
            }
          : null,
        visible: Boolean(
          rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight,
        ),
        scrollCalls: (window as Window & { __scrollCalls?: number })
          .__scrollCalls,
        frameCount: (
          window as Window & {
            __g11PaintDebug?: { lastPaintFrameCount: number };
          }
        ).__g11PaintDebug?.lastPaintFrameCount,
      };
    });
    console.info("G11 actual terminal row evidence", JSON.stringify(evidence));
    expect(evidence.rowCount).toBe(500);
    expect(evidence.targetText).toContain("Work item 500");
    expect(evidence.visible).toBe(true);
    expect(evidence.scrollCalls).toBe(1);
    expect(evidence.frameCount).toBe(2);
  });

  test("requires all 200 unique board IDs including the actual terminal card", async ({
    page,
  }) => {
    await mountFixture(
      page,
      boardMarkup((index) =>
        index === 200 ? "legacy-task-199" : `legacy-task-${index}`,
      ),
    );
    await install(page, BOARD_OPTIONS);
    await expectNoMark(page, "boardPaint");
  });

  test("does not mark when the terminal board card is absent despite 200 cards", async ({
    page,
  }) => {
    await mountFixture(
      page,
      boardMarkup((index) =>
        index === 200 ? "legacy-task-201" : `legacy-task-${index}`,
      ),
    );
    await install(page, BOARD_OPTIONS);
    await expectNoMark(page, "boardPaint");
  });

  test("does not mark a hidden terminal card", async ({ page }) => {
    await mountFixture(page, boardMarkup(undefined, "visibility:hidden"));
    await install(page, BOARD_OPTIONS);
    await expectNoMark(page, "boardPaint");
  });

  test("does not mark until an incomplete list reaches 500 actual rows", async ({
    page,
  }) => {
    await mountFixture(page, listMarkup(499));
    await install(page, LIST_OPTIONS);
    await expectNoMark(page, "listPaint");
  });

  test("does not mark until an incomplete board reaches 200 actual cards", async ({
    page,
  }) => {
    await mountFixture(page, boardMarkup(undefined, "", 199));
    await install(page, BOARD_OPTIONS);
    await expectNoMark(page, "boardPaint");
  });

  test("does not mark a terminal card with a zero-size layout box", async ({
    page,
  }) => {
    await mountFixture(page, boardMarkup(undefined, "width:0;height:0"));
    await install(page, BOARD_OPTIONS);
    await expectNoMark(page, "boardPaint");
  });

  test("invalidates a pending mark when the list body is replaced", async ({
    page,
  }) => {
    await mountFixture(page, listMarkup());
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent =
        "tbody tr { transform: translateY(-2000px) } tbody tr:last-child { transform: none }";
      document.head.append(style);
    });
    await mutateOnFirstAnimationFrame(page, "replace-list-body");
    await install(page, LIST_OPTIONS);
    await waitForMark(page, "listPaint");
    const evidence = await page.evaluate(() => ({
      revalidated:
        (
          window as Window & {
            __g11PaintDebug?: { revalidatedAttempts: number };
          }
        ).__g11PaintDebug?.revalidatedAttempts ?? 0,
      bodyConnected: document.querySelector(
        '[data-testid="work-item-list-populated"] tbody',
      )?.isConnected,
    }));
    expect(evidence.revalidated).toBeGreaterThan(0);
    expect(evidence.bodyConnected).toBe(true);
  });

  test("invalidates a pending mark when a card is detached and replaced", async ({
    page,
  }) => {
    await mountFixture(page, boardMarkup());
    await mutateOnFirstAnimationFrame(page, "replace-board-card");
    await install(page, BOARD_OPTIONS);
    await waitForMark(page, "boardPaint");
    const evidence = await page.evaluate(() => ({
      revalidated:
        (
          window as Window & {
            __g11PaintDebug?: { revalidatedAttempts: number };
          }
        ).__g11PaintDebug?.revalidatedAttempts ?? 0,
      cardCount: document.querySelectorAll('[data-task-id^="legacy-task-"]')
        .length,
    }));
    expect(evidence.revalidated).toBeGreaterThan(0);
    expect(evidence.cardCount).toBe(200);
  });

  test("retries after the terminal card is reparented before the second frame", async ({
    page,
  }) => {
    await mountFixture(
      page,
      `${boardMarkup(undefined, "position:fixed;top:8px;left:8px;height:30px;width:120px")}<section id="other-column"></section>`,
    );
    await mutateOnFirstAnimationFrame(page, "reparent-board-card");
    await install(page, BOARD_OPTIONS);
    await waitForMark(page, "boardPaint");
    const evidence = await page.evaluate(() => ({
      revalidated:
        (
          window as Window & {
            __g11PaintDebug?: { revalidatedAttempts: number };
          }
        ).__g11PaintDebug?.revalidatedAttempts ?? 0,
      parentId: document.querySelector('[data-task-id="legacy-task-200"]')
        ?.parentElement?.id,
      cardCount: document.querySelectorAll('[data-task-id^="legacy-task-"]')
        .length,
    }));
    expect(evidence.revalidated).toBeGreaterThan(0);
    expect(evidence.parentId).toBe("other-column");
    expect(evidence.cardCount).toBe(200);
  });

  test("does not scroll an already visible terminal card", async ({ page }) => {
    await mountFixture(
      page,
      boardMarkup(
        undefined,
        "position:fixed;top:8px;left:8px;height:30px;width:120px",
      ),
    );
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent =
        ".card:not([data-task-id='legacy-task-200']) { position: fixed; top: 1000px; height: 1px }";
      document.head.append(style);
      const original = Element.prototype.scrollIntoView;
      const state = window as Window & { __scrollCalls?: number };
      state.__scrollCalls = 0;
      Element.prototype.scrollIntoView = function (...args) {
        state.__scrollCalls = (state.__scrollCalls ?? 0) + 1;
        return original.apply(this, args);
      };
    });
    await install(page, BOARD_OPTIONS);
    await waitForMark(page, "boardPaint");
    const evidence = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-task-id^="legacy-task-"]');
      const target = document.querySelector('[data-task-id="legacy-task-200"]');
      const rect = target?.getBoundingClientRect();
      return {
        cardCount: cards.length,
        targetId: target?.getAttribute("data-task-id"),
        connected: Boolean(target?.isConnected),
        rect: rect
          ? {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
            }
          : null,
        visible: Boolean(
          rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight,
        ),
        scrollCalls: (window as Window & { __scrollCalls?: number })
          .__scrollCalls,
      };
    });
    console.info("G11 actual terminal card evidence", JSON.stringify(evidence));
    expect(evidence.cardCount).toBe(200);
    expect(evidence.targetId).toBe("legacy-task-200");
    expect(evidence.connected).toBe(true);
    expect(evidence.rect?.width).toBeGreaterThan(0);
    expect(evidence.rect?.height).toBeGreaterThan(0);
    expect(evidence.visible).toBe(true);
    expect(evidence.scrollCalls).toBe(0);
  });
});
