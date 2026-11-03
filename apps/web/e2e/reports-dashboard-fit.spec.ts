import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";
import { mountBuiltPortal, PORTAL_ORIGIN } from "./helpers/portal-dist-fixture";
import { installReportsFitFixture } from "./helpers/reports-fit-fixture";

// Thomas, 3 Nov: every report and dashboard chart fits its container at every width; wide
// content scrolls inside its own frame, never the page; labels and captions are never cut off.
// Agent screens run on the G11 network-edge fixture plus a reports overlay; the portal Dashboard
// runs on the built portal. Screenshots are evidence files, not G8 baselines.

const VIEWPORTS = [
  ["phone", { width: 390, height: 844 }],
  ["tablet", { width: 768, height: 1024 }],
  ["laptop", { width: 1280, height: 800 }],
  ["desktop", { width: 1920, height: 1080 }],
] as const;
const THEMES = ["light", "dark"] as const;

const SCREENSHOT_DIR = process.env.REPORTS_FIT_SCREENSHOT_DIR;

async function screenshot(page: Page, name: string) {
  const file = SCREENSHOT_DIR
    ? path.join(SCREENSHOT_DIR, `${name}.png`)
    : test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
}

async function expectTheme(page: Page, theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

/**
 * Nothing scrolls the page sideways: neither the document nor any ancestor of the page heading
 * (the agent screens scroll inside their own pane, not the document).
 */
async function expectNoPageOverflow(page: Page) {
  const overflow = await page
    .locator("h1")
    .first()
    .evaluate((heading) => {
      const wide: string[] = [];
      const root = document.documentElement;
      if (root.scrollWidth > window.innerWidth)
        wide.push(`document ${root.scrollWidth} > ${window.innerWidth}`);
      for (
        let node = heading.parentElement;
        node && node !== document.body;
        node = node.parentElement
      )
        if (node.scrollWidth > node.clientWidth + 1)
          wide.push(
            `${node.tagName.toLowerCase()}.${node.className} ${node.scrollWidth} > ${node.clientWidth}`,
          );
      return wide;
    });
  expect(overflow).toEqual([]);
}

/**
 * Every caption is whole: not cut inside its own box, and (for a dashboard widget) inside the
 * widget's visible frame rather than under its bottom edge or a fade.
 */
async function expectCaptionsWhole(page: Page) {
  const cut = await page.evaluate(() => {
    const problems: string[] = [];
    const captions = document.querySelectorAll<HTMLElement>(
      '[data-testid="widget-context"], [data-testid="report-context"], [data-slot="portal-kpi-card"] > span:last-child > span, [data-testid="dashboard-widget"] [data-slot="card-title"]',
    );
    for (const caption of captions) {
      if (!caption.getClientRects().length) continue;
      const text = (caption.textContent ?? "").slice(0, 40);
      if (caption.scrollHeight > caption.clientHeight + 1)
        problems.push(`taller than its box: ${text}`);
      if (caption.scrollWidth > caption.clientWidth + 1)
        problems.push(`wider than its box: ${text}`);
      const frame = caption.closest<HTMLElement>(
        '[data-testid="dashboard-widget"]',
      );
      if (frame) {
        const box = caption.getBoundingClientRect();
        const outer = frame.getBoundingClientRect();
        if (box.bottom > outer.bottom + 1 || box.right > outer.right + 1)
          problems.push(`outside its widget: ${text}`);
      }
    }
    // A KPI tile shows its whole content without scrolling or a fade.
    for (const tile of document.querySelectorAll<HTMLElement>(
      '[data-testid="dashboard-widget"][data-chart-type="number"] [data-slot="scroll-area-viewport"]',
    ))
      if (tile.scrollHeight > tile.clientHeight + 1)
        problems.push(
          `KPI tile scrolls: ${tile.scrollHeight} > ${tile.clientHeight}`,
        );
    // A chart widget shows the whole drawing, axis labels included, above the widget's bottom
    // edge: no label sits under the frame's fade.
    for (const widget of document.querySelectorAll<HTMLElement>(
      '[data-testid="dashboard-widget"]',
    )) {
      const figure = widget.querySelector("figure");
      const frame = widget.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (!figure?.getClientRects().length || !frame) continue;
      // The figure: hint, drawing and legend.
      const bottom = figure.getBoundingClientRect().bottom;
      const edge = frame.getBoundingClientRect().bottom;
      if (bottom > edge + 1)
        problems.push(
          `chart runs under its widget's edge: ${Math.round(bottom)} > ${Math.round(edge)}`,
        );
      // A wide chart scrolls inside its own frame, never the widget sideways.
      if (frame.scrollWidth > frame.clientWidth + 1)
        problems.push(
          `widget scrolls sideways: ${frame.scrollWidth} > ${frame.clientWidth}`,
        );
    }
    // A scroll fade is drawn only over content that really runs past the edge: each frame's
    // fade (its overflow value, capped at the 1.5rem fade size) matches what is left to scroll,
    // so a fitted chart's legend is never faded.
    const fadeSize =
      1.5 *
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    for (const frame of document.querySelectorAll<HTMLElement>(
      '[data-testid="dashboard-widget"] [data-slot="scroll-area-viewport"]',
    )) {
      if (!frame.getClientRects().length) continue;
      const left = {
        "--scroll-area-overflow-y-end": Math.max(
          0,
          frame.scrollHeight - frame.clientHeight - frame.scrollTop,
        ),
        "--scroll-area-overflow-x-end": Math.max(
          0,
          frame.scrollWidth - frame.clientWidth - frame.scrollLeft,
        ),
      };
      for (const [name, expected] of Object.entries(left)) {
        const drawn = Number.parseFloat(
          frame.style.getPropertyValue(name) || "0",
        );
        if (
          Math.abs(Math.min(fadeSize, drawn) - Math.min(fadeSize, expected)) > 1
        )
          problems.push(
            `${name} is ${drawn}px but ${expected}px is left to scroll: ${(frame.closest('[data-testid="dashboard-widget"]')?.textContent ?? "").slice(0, 30)}`,
          );
      }
    }
    return problems;
  });
  expect(cut).toEqual([]);
}

/**
 * Every chart is drawn at its real size: each axis label and tick sits inside the drawing, and a
 * drawing wider than its frame scrolls inside a named, focusable frame with a visible hint.
 */
async function expectChartsFit(page: Page) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    for (const svg of document.querySelectorAll<SVGSVGElement>(
      'figure svg[role="img"]',
    )) {
      if (!svg.getClientRects().length) continue;
      const area = svg.getBoundingClientRect();
      for (const text of svg.querySelectorAll("text")) {
        const box = text.getBoundingClientRect();
        if (
          box.left < area.left - 1 ||
          box.right > area.right + 1 ||
          box.top < area.top - 1 ||
          box.bottom > area.bottom + 1
        )
          found.push(`label outside its chart: ${text.textContent}`);
        if (text.textContent?.includes("…"))
          found.push(`label shortened: ${text.textContent}`);
      }
      const frame = svg.closest<HTMLElement>('[data-slot="chart-frame"]');
      if (!frame) {
        found.push("chart without a frame");
        continue;
      }
      if (area.width > frame.clientWidth + 1) {
        const region = frame.closest('[role="region"]');
        if (!region?.getAttribute("aria-label"))
          found.push("wide chart frame has no name");
        const hint = svg
          .closest("figure")
          ?.querySelector('[data-testid="chart-scroll-hint"]');
        if (!hint?.getClientRects().length)
          found.push("wide chart has no scroll hint");
      }
    }
    return found;
  });
  expect(problems).toEqual([]);
}

/**
 * Every table scrolls inside its own frame, and a table wider than that frame says so: the cut
 * edge fades (so no word ends hard at the frame edge) and a hint above the table is shown. A
 * table that fits shows no hint.
 */
async function expectTablesShowScroll(page: Page) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    for (const container of document.querySelectorAll<HTMLElement>(
      '[data-slot="table-container"]',
    )) {
      if (!container.getClientRects().length) continue;
      const name = container.getAttribute("aria-label") ?? "unnamed table";
      const viewport = container.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (!viewport) {
        found.push(`${name}: scrolls without a scroll frame`);
        continue;
      }
      const hint = container
        .closest('[data-slot="report-table"]')
        ?.querySelector<HTMLElement>('[data-testid="table-scroll-hint"]');
      const hintShown = Boolean(hint?.getClientRects().length);
      const overflows = viewport.scrollWidth > viewport.clientWidth + 1;
      if (!overflows) {
        if (hintShown) found.push(`${name}: hint shown on a table that fits`);
        continue;
      }
      const fadeLeft = Number.parseFloat(
        viewport.style.getPropertyValue("--scroll-area-overflow-x-end") || "0",
      );
      if (!viewport.className.includes("mask-r-from-") || fadeLeft <= 0)
        found.push(`${name}: wide table has no fade at its cut edge`);
      if (!hintShown) found.push(`${name}: wide table has no scroll hint`);
      if (!container.getAttribute("aria-label"))
        found.push("wide table frame has no name");
    }
    return found;
  });
  expect(problems).toEqual([]);
}

async function expectFits(page: Page) {
  await expectNoPageOverflow(page);
  await expectCaptionsWhole(page);
  await expectChartsFit(page);
  await expectTablesShowScroll(page);
}

/**
 * `RP-4`: every widget states its as-of time in its visible caption, not only behind "About".
 * The fixture has seven widgets, all computed at the same time.
 */
async function expectWidgetsStateAsOf(page: Page) {
  for (let index = 0; index < 7; index += 1)
    await expect(
      page
        .getByTestId("dashboard-widget")
        .nth(index)
        .getByTestId("widget-context")
        .getByText("As of Oct 21, 2026, 12:00 PM", { exact: true }),
    ).toBeVisible();
}

const AGENT_SCREENS = [
  {
    name: "reports-index",
    url: "/agent/reports",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "Reports", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Open items by age.", { exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "report-detail-throughput",
    url: "/agent/reports/throughput",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "Throughput", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("img", { name: /^Throughput: chart/ }),
      ).toBeVisible();
    },
  },
  {
    name: "report-detail-sla",
    url: "/agent/reports/sla_attainment",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "SLA attainment", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Paused for the customer", { exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "report-detail-at-risk-table",
    url: "/agent/reports/at_risk_now",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "At-risk now", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "INFRA-1234", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "report-builder",
    url: "/agent/reports/new",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "Report builder", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("53", { exact: true })).toBeVisible();
    },
  },
  {
    name: "report-export",
    url: "/agent/reports/exports/fit-export",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "Time logged", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Your export is ready", { exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "dashboard",
    url: "/agent/dashboard",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("92%", { exact: true })).toBeVisible();
      await expectWidgetsStateAsOf(page);
      await expect(
        page.getByRole("img", { name: /^Throughput: chart/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "INFRA-1234", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "dashboard-editor",
    url: "/agent/dashboard/edit",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "Dashboard editor", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("92%", { exact: true })).toBeVisible();
      await expectWidgetsStateAsOf(page);
      await expect(
        page.getByRole("img", { name: /^Throughput: chart/ }),
      ).toBeVisible();
    },
  },
] as const;

for (const [viewportName, viewport] of VIEWPORTS)
  for (const theme of THEMES) {
    for (const screen of AGENT_SCREENS)
      test(`${screen.name} fits at ${viewportName} (${theme}) @a11y`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme });
        await installPerformanceApiFixture(page);
        await installReportsFitFixture(page);
        // The agent app reads the persisted user preference (default dark), not the OS setting.
        await page.addInitScript((value) => {
          localStorage.setItem(
            "user-preferences",
            JSON.stringify({ state: { theme: value }, version: 0 }),
          );
        }, theme);
        await page.goto(screen.url);
        await expectTheme(page, theme);
        await screen.ready(page);
        // The seven-column At-risk table cannot fit a phone: its hint must be on screen, so the
        // table check above is proven to run on a real overflow.
        if (
          viewportName === "phone" &&
          screen.name === "report-detail-at-risk-table"
        )
          await expect(
            page.getByText("Scroll sideways to see all 7 columns.", {
              exact: true,
            }),
          ).toBeVisible();
        if (viewportName === "phone" && screen.name === "dashboard")
          await expect(
            page
              .getByTestId("dashboard-widget")
              .filter({
                has: page.getByRole("cell", {
                  name: "INFRA-1234",
                  exact: true,
                }),
              })
              .getByText("Scroll sideways to see all 7 columns.", {
                exact: true,
              }),
          ).toBeVisible();
        await expectFits(page);
        await screenshot(page, `${screen.name}-${viewportName}-${theme}`);
        // The agent pane scrolls inside itself, so a second shot shows the chart or table.
        const visual = page
          .locator('figure svg[role="img"], [data-slot="table"]')
          .first();
        if (await visual.count()) {
          await visual.scrollIntoViewIfNeeded();
          await screenshot(
            page,
            `${screen.name}-${viewportName}-${theme}-visual`,
          );
        }
        const lastWidget = page.getByTestId("dashboard-widget").last();
        if (await lastWidget.count()) {
          await lastWidget.scrollIntoViewIfNeeded();
          await screenshot(
            page,
            `${screen.name}-${viewportName}-${theme}-lower`,
          );
        }
        expect(await seriousOrCriticalViolations(page)).toEqual([]);
      });

    test(`portal dashboard KPI cards fit at ${viewportName} (${theme}) @a11y`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      const unmatched = await mountBuiltPortal(page, portalApiBody);
      await page.goto(`${PORTAL_ORIGIN}/`);
      await expectTheme(page, theme);
      await expect(
        page.getByText("Average first response", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "SUB-7", exact: true }),
      ).toBeVisible();
      await expectFits(page);
      await screenshot(page, `portal-dashboard-${viewportName}-${theme}`);
      expect(await seriousOrCriticalViolations(page)).toEqual([]);
      expect(unmatched).toEqual([]);
    });
  }

const portalSession = {
  session: {
    id: "fit-session",
    userId: "fit-customer",
    activeOrganizationId: null,
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "fit-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id: "fit-customer",
    name: "Ada Example",
    email: "ada@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    image: null,
  },
};

function portalApiBody(pathname: string): unknown {
  switch (pathname) {
    case "/api/auth/get-session":
      return portalSession;
    case "/api/config":
      return { disableRegistration: true, disableLoginForm: false };
    case "/api/public/terminology":
      return {};
    case "/api/me/settings":
      return { settings: {} };
    case "/api/portal/feature-state":
      return { state: "on" };
    case "/api/portal/me":
      return {
        name: "Ada Example",
        email: "ada@example.test",
        image: null,
        jobTitle: null,
        organisation: { name: "Infrastructure managed services customer" },
      };
    case "/api/portal/home":
      return {
        actionRequired: { total: 12, cases: 9, approvals: 3 },
        outstanding: 1234,
        closedLast30Days: 587,
        averageFirstResponse: { seconds: 185400, sampleSize: 40 },
      };
    case "/api/portal/requests":
      return {
        cases: [
          {
            ref: "SUB-7",
            source: "submission",
            title: "Access to the support workspace",
            requestTypeName: "Access request",
            priority: "high",
            customerStatus: "need_more_info",
            createdAt: "2026-09-15T00:00:00.000Z",
            updatedAt: "2026-09-16T09:30:00.000Z",
            project: { key: "HELP", name: "Help desk" },
            createdBy: { name: null, isYou: true },
            isRequester: true,
            customerVisibility: "private",
            sla: null,
          },
        ],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 1 },
      };
    case "/api/portal/approvals":
      return { approvals: [] };
    case "/api/portal/submissions":
      return { submissions: [], page: { hasMore: false, nextCursor: null } };
    case "/api/portal/kb":
      return { data: [], hasMore: false, nextCursor: null };
    case "/api/portal/releases":
      return { data: [] };
    case "/api/portal/announcements":
      return { data: [], nextCursor: null };
    case "/api/portal/notification/inbox":
      return { data: [], unreadCount: 0, hasMore: false, nextCursor: null };
    default:
      return undefined;
  }
}
