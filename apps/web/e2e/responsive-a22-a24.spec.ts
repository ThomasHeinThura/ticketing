import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  PROJECT as project,
} from "./helpers/g11-performance-fixture";
import { mountBuiltPortal, PORTAL_ORIGIN } from "./helpers/portal-dist-fixture";
import { installProjectOverviewFixture } from "./helpers/project-overview-fixture";

// Audit A-22 (portal KB at tablet), A-23 (backlog header at phone) and A-24 (portal orientation
// Alert at phone): each screen fits its viewport with nothing cut off and no sideways scroll, and
// the desktop layout is unchanged. Screenshots are evidence files in the test output, not G8
// baselines.

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const PHONE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 800 };

async function screenshot(page: Page, name: string) {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
}

async function expectTheme(page: Page, theme: Theme) {
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

/** Nothing scrolls sideways: neither the document nor any ancestor of the page heading. */
async function expectNoSidewaysScroll(page: Page) {
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

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("element has no box");
  return found;
}

/** The element is wholly on screen and wholly inside `frame` (nothing clipped at an edge). */
async function expectWhollyInside(locator: Locator, frame: Locator) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const inner = await box(locator);
  const outer = await box(frame);
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
}

/** How many text lines an element takes. */
async function lineCount(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    return Math.round(element.getBoundingClientRect().height / lineHeight);
  });
}

// --- Portal fixture ---------------------------------------------------------------------------

const portalSession = {
  session: {
    id: "responsive-session",
    userId: "responsive-customer",
    activeOrganizationId: null,
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "responsive-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id: "responsive-customer",
    name: "Ada Example",
    email: "ada@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    image: null,
  },
};

const KB_CATEGORIES = [
  { id: "cat-access", name: "Access and accounts", parentId: null },
  { id: "cat-sso", name: "Single sign-on", parentId: "cat-access" },
  { id: "cat-network", name: "Network and VPN", parentId: null },
  { id: "cat-billing", name: "Billing", parentId: null },
].map((category, position) => ({ ...category, position, articleCount: 2 }));

const KB_ARTICLES = [
  {
    id: "kb-1",
    title: "Reset your password from the sign-in page",
    snippet:
      "Use the forgotten-password link on the sign-in page; the reset link is valid for one hour.",
    categoryId: "cat-access",
    publishedAt: "2026-10-01T09:00:00.000Z",
  },
  {
    id: "kb-2",
    title: "Connect to the managed VPN from a new laptop",
    snippet:
      "Install the client, import the profile you received by email and sign in with your work account.",
    categoryId: "cat-network",
    publishedAt: "2026-10-02T09:00:00.000Z",
  },
];

function portalApiBody(kbArticles: typeof KB_ARTICLES) {
  return (pathname: string): unknown => {
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
          actionRequired: { total: 2, cases: 1, approvals: 1 },
          outstanding: 4,
          closedLast30Days: 12,
          averageFirstResponse: { seconds: 5400, sampleSize: 10 },
        };
      case "/api/portal/requests":
        return {
          cases: [],
          page: { hasMore: false, nextCursor: null },
          meta: { total: 0 },
        };
      case "/api/portal/approvals":
        return { approvals: [] };
      case "/api/portal/submissions":
        return { submissions: [], page: { hasMore: false, nextCursor: null } };
      case "/api/portal/kb":
        return { articles: kbArticles, total: kbArticles.length };
      case "/api/portal/kb/categories":
        return { categories: KB_CATEGORIES };
      case "/api/portal/releases":
        return { data: [] };
      case "/api/portal/announcements":
        return { data: [], nextCursor: null };
      case "/api/portal/projects":
        return { data: [] };
      case "/api/portal/notification/inbox":
        return { data: [], unreadCount: 0, hasMore: false, nextCursor: null };
      default:
        return undefined;
    }
  };
}

async function openPortal(
  page: Page,
  url: string,
  theme: Theme,
  viewport: { width: number; height: number },
  kbArticles = KB_ARTICLES,
) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  const unmatched = await mountBuiltPortal(page, portalApiBody(kbArticles));
  await page.goto(`${PORTAL_ORIGIN}${url}`);
  await expectTheme(page, theme);
  return unmatched;
}

// --- A-22: portal knowledge base --------------------------------------------------------------

for (const theme of THEMES)
  for (const [label, articles] of [
    ["articles", KB_ARTICLES],
    ["empty", []],
  ] as const) {
    test(`A-22 portal KB stacks categories above ${label} at 768 (${theme})`, async ({
      page,
    }) => {
      const unmatched = await openPortal(page, "/kb", theme, TABLET, [
        ...articles,
      ]);
      const categories = page.getByRole("navigation", { name: "Categories" });
      await expect(
        categories.getByRole("button", { name: "Single sign-on" }),
      ).toBeVisible();
      const popular = page.getByRole("tab", { name: "Most viewed" });
      await expect(popular).toBeVisible();
      // The article column is a sibling of the category list.
      const column = page.locator("main nav + div");
      if (articles.length)
        await expect(
          page.getByRole("link", { name: KB_ARTICLES[0].title }),
        ).toBeVisible();
      else
        await expect(
          page.getByText("No articles yet", { exact: true }),
        ).toBeVisible();
      // Evidence first, so a failing run still records what it saw.
      await screenshot(page, `a22-portal-kb-${label}-768-${theme}`);
      await expectNoSidewaysScroll(page);
      // Stacked: the categories sit above the articles, which take the full content width.
      const nav = await box(categories);
      const list = await box(column);
      expect(nav.y + nav.height).toBeLessThanOrEqual(list.y + 1);
      expect(list.width).toBeGreaterThanOrEqual(nav.width - 1);
      expect(list.width).toBeGreaterThan(400);
      await expectWhollyInside(popular, column);
      if (!articles.length) {
        expect(
          await lineCount(column.locator('[data-slot="empty-title"]')),
        ).toBeLessThanOrEqual(1);
        expect(
          await lineCount(column.locator('[data-slot="empty-description"]')),
        ).toBeLessThanOrEqual(2);
      }
      expect(unmatched).toEqual([]);
    });

    test(`A-22 portal KB keeps categories beside ${label} at 1280 (${theme})`, async ({
      page,
    }) => {
      const unmatched = await openPortal(page, "/kb", theme, DESKTOP, [
        ...articles,
      ]);
      const categories = page.getByRole("navigation", { name: "Categories" });
      await expect(
        categories.getByRole("button", { name: "Single sign-on" }),
      ).toBeVisible();
      const popular = page.getByRole("tab", { name: "Most viewed" });
      await expect(popular).toBeVisible();
      const column = page.locator("main nav + div");
      // Evidence first, so a failing run still records what it saw.
      await screenshot(page, `a22-portal-kb-${label}-1280-${theme}`);
      await expectNoSidewaysScroll(page);
      const nav = await box(categories);
      const list = await box(column);
      expect(nav.x + nav.width).toBeLessThanOrEqual(list.x);
      expect(Math.abs(nav.y - list.y)).toBeLessThanOrEqual(1);
      await expectWhollyInside(popular, column);
      expect(unmatched).toEqual([]);
    });
  }

// --- A-24: portal orientation Alert -----------------------------------------------------------

for (const theme of THEMES) {
  test(`A-24 portal orientation stacks title, description and action at 375 (${theme})`, async ({
    page,
  }) => {
    const unmatched = await openPortal(page, "/", theme, PHONE);
    const alert = page.getByRole("alert").filter({
      has: page.getByText("Welcome to your portal", { exact: true }),
    });
    await expect(alert).toBeVisible();
    const title = alert.locator('[data-slot="alert-title"]');
    const description = alert.locator('[data-slot="alert-description"]');
    const action = alert.locator('[data-slot="alert-action"]');
    const dismiss = action.getByRole("button", { name: "Got it" });
    // Evidence first, so a failing run still records what it saw.
    await screenshot(page, `a24-portal-orientation-375-${theme}`);
    await expectNoSidewaysScroll(page);
    const titleBox = await box(title);
    const descriptionBox = await box(description);
    const actionBox = await box(action);
    // Title above description above action, all starting at the same left edge.
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(
      descriptionBox.y + 1,
    );
    expect(descriptionBox.y + descriptionBox.height).toBeLessThanOrEqual(
      actionBox.y + 1,
    );
    expect(Math.abs(descriptionBox.x - titleBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(actionBox.x - titleBox.x)).toBeLessThanOrEqual(1);
    // The description uses the full width of the alert, not a squeezed side column.
    expect(descriptionBox.width).toBeGreaterThanOrEqual(titleBox.width - 1);
    await expectWhollyInside(dismiss, alert);
    expect(unmatched).toEqual([]);
  });

  test(`A-24 portal orientation keeps its action beside the text at 1280 (${theme})`, async ({
    page,
  }) => {
    const unmatched = await openPortal(page, "/", theme, DESKTOP);
    const alert = page.getByRole("alert").filter({
      has: page.getByText("Welcome to your portal", { exact: true }),
    });
    await expect(alert).toBeVisible();
    const title = await box(alert.locator('[data-slot="alert-title"]'));
    const description = await box(
      alert.locator('[data-slot="alert-description"]'),
    );
    const action = await box(alert.locator('[data-slot="alert-action"]'));
    expect(title.y + title.height).toBeLessThanOrEqual(description.y + 1);
    expect(Math.abs(description.x - title.x)).toBeLessThanOrEqual(1);
    expect(action.x).toBeGreaterThanOrEqual(description.x + description.width);
    // Evidence first, so a failing run still records what it saw.
    await screenshot(page, `a24-portal-orientation-1280-${theme}`);
    await expectNoSidewaysScroll(page);
    expect(unmatched).toEqual([]);
  });
}

// A-24 also covers the other shape of the shared Alert: an icon plus an action (the project
// overview's "waiting on prerequisites" warning). Below `sm` the action drops under the text in
// the text column beside the icon; from `sm` it keeps its own column on the right.
async function openOverviewAttention(
  page: Page,
  theme: Theme,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await installPerformanceApiFixture(page);
  await installProjectOverviewFixture(page, PROJECT_ID, { project });
  await page.addInitScript((value) => {
    localStorage.setItem(
      "user-preferences",
      JSON.stringify({ state: { theme: value }, version: 0 }),
    );
  }, theme);
  await page.goto("/agent/projects/WLP");
  await expectTheme(page, theme);
  const alert = page.getByTestId("project-overview-attention");
  await expect(alert).toBeVisible();
  return {
    alert,
    icon: alert.locator(":scope > svg"),
    description: alert.locator('[data-slot="alert-description"]'),
    action: alert.locator('[data-slot="alert-action"]'),
  };
}

for (const theme of THEMES) {
  test(`A-24 icon alert puts its action under the text at 375 (${theme})`, async ({
    page,
  }) => {
    const { alert, icon, description, action } = await openOverviewAttention(
      page,
      theme,
      PHONE,
    );
    // Evidence first, so a failing run still records what it saw.
    await screenshot(page, `a24-overview-attention-375-${theme}`);
    await expectNoSidewaysScroll(page);
    const iconBox = await box(icon);
    const descriptionBox = await box(description);
    const actionBox = await box(action);
    // Description and action share the text column beside the icon; the action sits below.
    expect(descriptionBox.x).toBeGreaterThan(iconBox.x + iconBox.width);
    expect(Math.abs(actionBox.x - descriptionBox.x)).toBeLessThanOrEqual(1);
    expect(descriptionBox.y + descriptionBox.height).toBeLessThanOrEqual(
      actionBox.y + 1,
    );
    await expectWhollyInside(action.getByText("See what is waiting"), alert);
  });

  test(`A-24 icon alert keeps its action on the right at 1280 (${theme})`, async ({
    page,
  }) => {
    const { alert, description, action } = await openOverviewAttention(
      page,
      theme,
      DESKTOP,
    );
    // Evidence first, so a failing run still records what it saw.
    await screenshot(page, `a24-overview-attention-1280-${theme}`);
    await expectNoSidewaysScroll(page);
    const descriptionBox = await box(description);
    const actionBox = await box(action);
    expect(actionBox.x).toBeGreaterThanOrEqual(
      descriptionBox.x + descriptionBox.width,
    );
    await expectWhollyInside(action.getByText("See what is waiting"), alert);
  });
}

// --- A-23: project backlog header -------------------------------------------------------------

async function openBacklog(
  page: Page,
  theme: Theme,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await installPerformanceApiFixture(page);
  // The agent app reads the persisted user preference, not the OS setting.
  await page.addInitScript((value) => {
    localStorage.setItem(
      "user-preferences",
      JSON.stringify({ state: { theme: value }, version: 0 }),
    );
  }, theme);
  await page.goto("/agent/projects/WLP/backlog");
  await expectTheme(page, theme);
  const backlog = page.getByTestId("project-backlog-page");
  await expect(
    backlog.getByRole("heading", { name: "Performance fixture · Backlog" }),
  ).toBeVisible();
  const create = backlog.getByTestId("create-work-item-trigger");
  await expect(create).toBeVisible();
  return { backlog, create };
}

for (const theme of THEMES) {
  test(`A-23 backlog header shows Create Work item at 375 with no sideways scroll (${theme})`, async ({
    page,
  }) => {
    const { backlog, create } = await openBacklog(page, theme, PHONE);
    // Evidence first, so a failing run still records what it saw.
    await screenshot(page, `a23-backlog-375-${theme}`);
    await expectNoSidewaysScroll(page);
    const scroll = await backlog.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
    await expectWhollyInside(create, backlog);
    await expectWhollyInside(
      backlog.getByRole("button", { name: "Filter", exact: true }),
      backlog,
    );
  });

  test(`A-23 backlog header keeps title and actions on one row at 1280 (${theme})`, async ({
    page,
  }) => {
    const { backlog, create } = await openBacklog(page, theme, DESKTOP);
    // Evidence first, so a failing run still records what it saw.
    await screenshot(page, `a23-backlog-1280-${theme}`);
    await expectNoSidewaysScroll(page);
    const heading = await box(
      backlog.getByRole("heading", { name: "Performance fixture · Backlog" }),
    );
    const action = await box(create);
    // One header row: the action sits to the right of the title, on the same line.
    expect(action.x).toBeGreaterThan(heading.x + heading.width);
    expect(
      Math.abs(action.y + action.height / 2 - (heading.y + heading.height / 2)),
    ).toBeLessThanOrEqual(8);
    await expectWhollyInside(create, backlog);
  });
}
