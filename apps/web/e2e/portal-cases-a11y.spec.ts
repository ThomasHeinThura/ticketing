import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";

// S4b (G4): the portal Dashboard (`/`) and the cases list (`/requests`) — KPI cards, the
// cases table, the scope toggle, filter popovers and paging — must pass axe in light and
// dark, on desktop and at phone width. The built portal (`dist/portal`, made by
// `pnpm build`) is served from disk on a portal origin; every API read is a fixture.
const PORTAL_ORIGIN = "http://portal.localhost:4180";
const PORTAL_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/portal",
);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const session = {
  session: {
    id: "a11y-session",
    userId: "a11y-customer",
    activeOrganizationId: null,
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "a11y-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id: "a11y-customer",
    name: "Ada Example",
    email: "ada@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    image: null,
  },
};

const baseCase = {
  source: "submission",
  requestTypeName: "Access request",
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-16T09:30:00.000Z",
  project: { key: "HELP", name: "Help desk" },
  isRequester: true,
  customerVisibility: "private",
  sla: null,
};

const casesPage = {
  cases: [
    {
      ...baseCase,
      ref: "SUB-7",
      title: "Access to the support workspace",
      priority: "high",
      customerStatus: "need_more_info",
      createdBy: { name: null, isYou: true },
    },
    {
      ...baseCase,
      ref: "HELP-12",
      source: "direct",
      title: "Renew the TLS certificate",
      requestTypeName: "Task",
      priority: "medium",
      customerStatus: "in_progress",
      createdBy: { name: "Dana Customer", isYou: false },
      isRequester: false,
      customerVisibility: "organisation",
    },
    {
      // Long names and the widest badges: the table must still fit its frame (no sideways
      // scroll) at laptop widths, and the service target must show (CP-6).
      ...baseCase,
      ref: "SUB-1234",
      title:
        "Our production VPN gateway keeps dropping connections for the whole Singapore office every afternoon after the latest firmware update",
      requestTypeName: "Incident with a very long request type name",
      priority: "urgent",
      customerStatus: "need_more_info",
      createdBy: {
        name: "Maximilian Alexander Featherstonehaugh",
        isYou: false,
      },
      project: {
        key: "INFRA",
        name: "Infrastructure managed services platform",
      },
      sla: {
        state: "at_risk",
        dueAt: "2099-01-01T10:00:00.000Z",
        metric: "resolution",
      },
    },
  ],
  page: { hasMore: true, nextCursor: "a11y-next" },
  meta: { total: 4 },
};

const infraProject = {
  key: "INFRA",
  name: "Infrastructure managed services platform",
  kind: "managed_service",
  status: "active",
  health: "amber",
  counts: { actionRequired: 2, outstanding: 3 },
};

/** U-11 Project Details: the customer view of the one fixture project. */
const infraProjectDetail = {
  ...infraProject,
  description: "Run and patch the customer's infrastructure.",
  createdAt: "2026-01-05T09:00:00.000Z",
  supportLevel: "L2",
  serviceCalendarName: "Business hours",
  summary: {
    objective: "Keep the platform patched and available.",
    inScope: null,
    outOfScope: null,
    successCriteria: null,
  },
  goLive: null,
  milestones: [],
  prerequisites: [],
  documents: [],
  contacts: [
    {
      kind: "manager",
      role: null,
      name: "Mara Manager",
      email: "mara.manager@example.test",
    },
  ],
  contract: {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    period: {
      state: "active",
      totalDays: 365,
      elapsedDays: 304,
      daysRemaining: 61,
      elapsedPct: 83,
    },
    hours: {
      contractedMinutes: 12000,
      usedMinutes: 7530,
      remainingMinutes: 4470,
      usedPct: 63,
    },
  },
};

/** Fixture reads of the portal shell and the screens. */
function apiBody(pathname: string): unknown {
  switch (pathname) {
    case "/api/auth/get-session":
      return session;
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
        organisation: { name: "Contoso" },
      };
    case "/api/portal/home":
      return {
        actionRequired: { total: 2, cases: 1, approvals: 1 },
        outstanding: 3,
        closedLast30Days: 5,
        averageFirstResponse: { seconds: 5400, sampleSize: 4 },
      };
    case "/api/portal/projects":
      // One project: the dashboard shows its card; the top-bar selector stays hidden.
      return { data: [infraProject] };
    case "/api/portal/projects/INFRA":
      return infraProjectDetail;
    case "/api/portal/requests":
      return casesPage;
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

async function mountPortal(page: Page) {
  if (!existsSync(path.join(PORTAL_DIST, "index.html")))
    throw new Error(
      `The built portal is missing at ${PORTAL_DIST}; run \`pnpm build\` first.`,
    );
  const indexHtml = readFileSync(path.join(PORTAL_DIST, "index.html"));
  const unmatched: string[] = [];
  await page.route(`${PORTAL_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) {
      const body = apiBody(url.pathname);
      if (body === undefined) {
        unmatched.push(`${route.request().method()} ${url.pathname}`);
        return route.fulfill({ status: 404, body: "" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    }
    const file = path.join(PORTAL_DIST, path.normalize(url.pathname));
    if (
      file.startsWith(PORTAL_DIST) &&
      url.pathname !== "/" &&
      existsSync(file) &&
      statSync(file).isFile()
    )
      return route.fulfill({
        status: 200,
        contentType:
          CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        body: readFileSync(file),
      });
    // Single-page fallback: every screen URL serves the portal shell.
    return route.fulfill({
      status: 200,
      contentType: CONTENT_TYPES[".html"],
      body: indexHtml,
    });
  });
  return unmatched;
}

async function expectTheme(page: Page, theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

/**
 * Severity and status are always on screen without a sideways scroll: as columns in a wide frame,
 * under the case title in a narrow one (the table sizes its columns by container width).
 */
async function expectSeverityAndStatus(page: Page, viewportName: ViewportName) {
  if (viewportName !== "mobile") {
    await expect(
      page.getByRole("columnheader", { name: "Severity" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Status", exact: true }),
    ).toBeVisible();
  }
  // Each badge is rendered twice (column and Details); CSS shows exactly one of them.
  const row = page.getByRole("row").filter({ hasText: "SUB-7" });
  await expect(
    row.getByText("High", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    row
      .getByText("We need more from you", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
}

/**
 * The cases table never needs a sideways scroll: its width stays within the frame, and the
 * service target of the long row shows (under the status in a wide frame, under the title in a
 * narrow one).
 */
async function expectTableFitsWithServiceTarget(page: Page) {
  const row = page.getByRole("row").filter({ hasText: "SUB-1234" });
  await expect(
    row.getByText("Due soon", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    row.getByText(/^Resolution due by /).filter({ visible: true }),
  ).toBeVisible();
  const widths = await page.locator("table").evaluate((table) => ({
    table: table.getBoundingClientRect().width,
    frame:
      table.closest("[data-slot=frame]")?.getBoundingClientRect().width ?? 0,
  }));
  expect(widths.frame).toBeGreaterThan(0);
  expect(widths.table).toBeLessThanOrEqual(widths.frame);
}

const VIEWPORTS = [
  ["desktop", { width: 1280, height: 800 }],
  // Common laptops: the Project and Created columns show here (frame at least 64rem).
  ["laptop-1366", { width: 1366, height: 768 }],
  ["laptop-1440", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
] as const;
type ViewportName = (typeof VIEWPORTS)[number][0];
const THEMES = ["light", "dark"] as const;

for (const [viewportName, viewport] of VIEWPORTS)
  for (const theme of THEMES) {
    test(`portal dashboard (${viewportName}, ${theme}) has no serious or critical axe violations @a11y`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      const unmatched = await mountPortal(page);
      await page.goto(`${PORTAL_ORIGIN}/`);
      await expectTheme(page, theme);
      // The KPI cards and the outstanding cases table have painted with fixture data.
      await expect(page.getByText("Average first response")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "SUB-7", exact: true }),
      ).toBeVisible();
      // S4c: the projects card list has painted with the fixture project.
      await expect(
        page.getByRole("heading", { name: "Your projects", exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Your projects", exact: true })
          .getByRole("link", {
            name: "Infrastructure managed services platform",
            exact: true,
          }),
      ).toBeVisible();
      await expectSeverityAndStatus(page, viewportName);
      // CP-4: the assignee is always "Your team" (the column is hidden in a narrow frame).
      await expect(page.getByText("Your team").first()).toBeAttached();
      await expectTableFitsWithServiceTarget(page);
      expect(await seriousOrCriticalViolations(page)).toEqual([]);
      expect(unmatched).toEqual([]);
    });

    test(`portal cases list (${viewportName}, ${theme}) has no serious or critical axe violations @a11y`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      const unmatched = await mountPortal(page);
      await page.goto(`${PORTAL_ORIGIN}/requests?scope=all&from=2026-09-01`);
      await expectTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "Support Requests", exact: true }),
      ).toBeVisible();
      // A staff-raised (D6) row is listed alongside the caller's own submission.
      await expect(page.getByText("Renew the TLS certificate")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "SUB-7", exact: true }),
      ).toBeVisible();
      await expectSeverityAndStatus(page, viewportName);
      await expectTableFitsWithServiceTarget(page);
      if (viewportName.startsWith("laptop"))
        for (const name of ["Project", "Created", "Assigned to"])
          await expect(
            page.getByRole("columnheader", { name, exact: true }),
          ).toBeVisible();
      expect(await seriousOrCriticalViolations(page)).toEqual([]);

      // With the Status filter popover open.
      await page.getByRole("button", { name: /^Status/ }).click();
      await expect(
        page.getByRole("menuitemcheckbox", { name: "Received" }),
      ).toBeVisible();
      expect(await seriousOrCriticalViolations(page)).toEqual([]);
      await page.keyboard.press("Escape");

      // With the Created date popover open (a date is set, so "Clear dates" shows).
      await page.getByRole("button", { name: /^Created/ }).click();
      const dates = page.getByRole("dialog");
      await expect(dates.getByText("From", { exact: true })).toBeVisible();
      await expect(
        dates.getByRole("button", { name: "Clear dates" }),
      ).toBeVisible();
      expect(await seriousOrCriticalViolations(page)).toEqual([]);

      // The nested calendar still opens and sets the date inside the modal popover.
      await dates.getByRole("button", { name: "To", exact: true }).click();
      const calendar = page.getByRole("grid").last();
      await expect(calendar).toBeVisible();
      expect(await seriousOrCriticalViolations(page)).toEqual([]);
      await calendar.getByRole("button").filter({ hasText: /^20$/ }).click();
      await expect(page).toHaveURL(/[?&]to=\d{4}-\d{2}-20(&|$)/);
      expect(unmatched).toEqual([]);
    });

    test(`portal project details (${viewportName}, ${theme}) shows the engagement's figures and cases and has no serious or critical axe violations @a11y`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      const unmatched = await mountPortal(page);
      // U-11: the figures and the cases are read for this project only.
      const scopedHome = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === "/api/portal/home" &&
          new URL(request.url()).searchParams.get("project") === "INFRA",
      );
      const scopedCases = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === "/api/portal/requests" &&
          new URL(request.url()).searchParams.get("project") === "INFRA",
      );
      await page.goto(`${PORTAL_ORIGIN}/projects/INFRA`);
      await expectTheme(page, theme);
      await scopedHome;
      await scopedCases;
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Infrastructure managed services platform",
          exact: true,
        }),
      ).toBeVisible();
      const figures = page.getByRole("region", {
        name: "Project figures",
        exact: true,
      });
      await expect(figures.getByText("Average first response")).toBeVisible();
      await expect(figures.getByText("Closed", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("link", { name: "SUB-7", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /^View all / }),
      ).toHaveAttribute("href", /[?&]project=INFRA(&|$)/);
      await expectSeverityAndStatus(page, viewportName);
      await expectTableFitsWithServiceTarget(page);
      // Never a sideways page scroll.
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(await seriousOrCriticalViolations(page)).toEqual([]);

      // Keyboard: the My/All toggle switches the scoped list to All and keeps the project.
      const all = page.getByRole("button", { name: /^All / });
      await all.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/projects\/INFRA\?.*scope=all/);
      await expect(all).toBeFocused();
      expect(unmatched).toEqual([]);
    });
  }
