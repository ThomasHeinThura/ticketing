import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * D7 announcements, customer side: the built portal (`dist/portal`, produced by `pnpm build`
 * before every browser job) is served on its own origin, 127.0.0.1:4179, with a mocked API.
 * Covers the list, the detail and back, the Release notes tab, and the shell banner (shown,
 * dismissed, still dismissed after a reload in the same session). The G4 scans cover the list,
 * the detail and a page with the banner on desktop (light) and phone (dark) widths.
 */
const PORTAL = "http://127.0.0.1:4179";
const DIST = fileURLToPath(new URL("../dist/portal/", import.meta.url));

const uiRequire = createRequire(
  new URL("../../../packages/ui/package.json", import.meta.url),
);
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

async function seriousOrCriticalViolations(page: Page) {
  await page.addScriptTag({ content: axeCoreSource });
  return page.evaluate(async () => {
    type BrowserAxe = {
      run: (
        context: Document,
        options: { runOnly: { type: "tag"; values: string[] } },
      ) => Promise<{
        violations: Array<{
          id: string;
          impact: string | null;
          nodes: Array<{ target: string[] }>;
        }>;
      }>;
    };
    const axe = (window as typeof window & { axe: BrowserAxe }).axe;
    const { violations } = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        targets: v.nodes.map((node) => node.target.join(" ")),
      }));
  });
}

const session = {
  session: {
    id: "portal-session",
    userId: "portal-user",
    activeOrganizationId: null,
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "portal-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id: "portal-user",
    name: "Casey Customer",
    email: "casey@contoso.example",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    image: null,
    role: "user",
  },
};

const maintenance = {
  id: "announcement-maintenance",
  title: "Database maintenance window",
  body: "The help desk is read-only while the database is upgraded.\nRequests sent during the window are queued and answered afterwards.",
  severity: "maintenance",
  startsAt: "2026-10-21T22:00:00.000Z",
  endsAt: "2099-01-11T01:00:00.000Z",
  publishedAt: "2026-10-20T09:00:00.000Z",
};

const incident = {
  id: "announcement-incident",
  title: "Email delivery is delayed",
  body: "Notification emails may arrive up to an hour late.",
  severity: "incident",
  startsAt: "2026-10-22T08:00:00.000Z",
  endsAt: null,
  publishedAt: "2026-10-22T08:05:00.000Z",
};

const info = {
  id: "announcement-info",
  title: "New request form for access changes",
  body: "",
  severity: "info",
  startsAt: "2026-10-20T08:00:00.000Z",
  endsAt: null,
  publishedAt: "2026-10-20T08:00:00.000Z",
};

const releases = {
  data: [
    {
      id: "release-mail",
      name: "Mail relay patch 2026.09",
      serviceName: "Email delivery",
      plannedDate: "2026-09-29",
      notes: "Delayed notification emails are delivered again.",
      publishedAt: "2026-09-29T21:30:00.000Z",
    },
  ],
  nextCursor: null,
};

function apiBody(url: URL, options: { banner: boolean }): unknown {
  const pathname = url.pathname;
  if (pathname === "/api/auth/get-session") return session;
  if (pathname === "/api/config")
    return {
      disableRegistration: true,
      disablePasswordRegistration: false,
      disableEmailOtpSignIn: true,
      disableWorkspaceCreation: true,
      hasSmtp: false,
      hasGithubSignIn: false,
      hasGoogleSignIn: false,
      hasDiscordSignIn: false,
      hasCustomOAuth: false,
      disableLoginForm: false,
      customOAuthAutoLogin: false,
      customOAuthLogoutUrl: null,
    };
  if (pathname === "/api/me/settings") return { settings: {} };
  if (pathname === "/api/portal/feature-state") return { state: "on" };
  if (pathname === "/api/portal/notification/inbox")
    return { data: [], unreadCount: 0, hasMore: false, nextCursor: null };
  if (pathname === "/api/portal/kb") return { data: [], nextCursor: null };
  if (pathname === "/api/portal/releases") return releases;
  if (pathname === "/api/portal/announcements") {
    // The shell banner asks for incidents and maintenance only.
    if (url.searchParams.get("severity") === "incident,maintenance")
      return {
        data: options.banner ? [incident, maintenance] : [],
        nextCursor: null,
      };
    return { data: [maintenance, info], nextCursor: null };
  }
  if (pathname === `/api/portal/announcements/${maintenance.id}`)
    return maintenance;
  if (pathname === `/api/portal/announcements/${info.id}`) return info;
  return [];
}

function serveStatic(route: Route, url: URL) {
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/u, "");
  const candidate = path.resolve(DIST, relative);
  const inside = candidate.startsWith(DIST);
  const file =
    inside && relative !== "" && existsSync(candidate)
      ? statSync(candidate).isFile()
        ? candidate
        : null
      : null;
  // Every non-file path is a client route of the single-page portal.
  return route.fulfill({ path: file ?? path.join(DIST, "index.html") });
}

async function installPortal(page: Page, options = { banner: false }) {
  if (!existsSync(path.join(DIST, "index.html")))
    throw new Error(
      "Build the portal first: pnpm --filter @taskdesk/web build",
    );
  await page.route(`${PORTAL}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({ json: apiBody(url, options) });
    return serveStatic(route, url);
  });
}

test("customer opens an announcement, goes back and switches to release notes", async ({
  page,
}) => {
  await installPortal(page);
  await page.goto(`${PORTAL}/announcements`);
  await expect(
    page.getByRole("heading", { name: "Announcements", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Announcements", exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("link", { name: maintenance.title, exact: true })
    .click();
  await expect(page).toHaveURL(`${PORTAL}/announcements/${maintenance.id}`);
  await expect(
    page.getByRole("heading", { name: maintenance.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Requests sent during the window are queued", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Back to announcements", exact: true })
    .click();
  await expect(page).toHaveURL(`${PORTAL}/announcements`);
  await expect(
    page.getByRole("link", { name: info.title, exact: true }),
  ).toBeVisible();
  const tabs = page.getByRole("navigation", {
    name: "Announcements and release notes",
  });
  await expect(
    tabs.getByRole("link", { name: "Announcements", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Release notes", exact: true }).click();
  await expect(page).toHaveURL(`${PORTAL}/releases`);
  await expect(
    page.getByRole("heading", { name: "Release notes", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Mail relay patch 2026.09")).toBeVisible();
  await expect(
    tabs.getByRole("link", { name: "Release notes", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("customer dismisses the banner and it stays dismissed after a reload", async ({
  page,
}) => {
  await installPortal(page, { banner: true });
  await page.goto(`${PORTAL}/releases`);
  const banner = page.getByRole("alert").filter({ hasText: maintenance.title });
  await expect(banner).toBeVisible();
  await expect(banner.getByText("Planned maintenance")).toBeVisible();
  await banner
    .getByRole("button", { name: `Dismiss ${maintenance.title}` })
    .click();
  await expect(banner).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Release notes", exact: true }),
  ).toBeVisible();
  // The incident was not dismissed, so it proves the banner rendered after the reload.
  const incidentBanner = page
    .getByRole("alert")
    .filter({ hasText: incident.title });
  await expect(incidentBanner).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Release notes", exact: true }),
  ).toBeVisible();
  await expect(incidentBanner).toBeVisible();
  await expect(incidentBanner.getByText("Incident")).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: maintenance.title }),
  ).toHaveCount(0);
});

test("the banner title opens the announcement", async ({ page }) => {
  await installPortal(page, { banner: true });
  await page.goto(`${PORTAL}/releases`);
  await page
    .getByRole("alert")
    .getByRole("link", { name: maintenance.title, exact: true })
    .click();
  await expect(page).toHaveURL(`${PORTAL}/announcements/${maintenance.id}`);
  await expect(
    page.getByRole("heading", { name: maintenance.title, exact: true }),
  ).toBeVisible();
});

for (const [width, height, colorScheme] of [
  [1280, 720, "light"],
  [390, 844, "dark"],
] as const)
  test(`portal announcements, detail and banner (${width}px, ${colorScheme}) have no serious or critical axe violations @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await installPortal(page, { banner: true });
    const noHorizontalScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

    await page.goto(`${PORTAL}/announcements`);
    await expect(
      page.getByRole("link", { name: info.title, exact: true }),
    ).toBeVisible();
    // The banner is on this page too, so the list scan covers it.
    await expect(
      page.getByRole("button", { name: `Dismiss ${maintenance.title}` }),
    ).toBeVisible();
    expect(await noHorizontalScroll()).toBe(true);
    expect(await seriousOrCriticalViolations(page)).toEqual([]);

    await page.goto(`${PORTAL}/announcements/${maintenance.id}`);
    await expect(
      page.getByRole("heading", { name: maintenance.title, exact: true }),
    ).toBeVisible();
    expect(await noHorizontalScroll()).toBe(true);
    expect(await seriousOrCriticalViolations(page)).toEqual([]);

    await page.goto(`${PORTAL}/releases`);
    await expect(
      page.getByRole("heading", { name: "Release notes", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: maintenance.title }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await noHorizontalScroll()).toBe(true);
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
