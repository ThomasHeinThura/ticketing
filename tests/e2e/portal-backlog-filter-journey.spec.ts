import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page, Response } from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import { fillSensitive, privateRequest } from "./helpers/fill-sensitive";
import {
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  totpForUri,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "./helpers/project-key";

/**
 * D14: a customer selects projects on Requests and sees the matching accepted
 * backlog items after switching views, including reload and organisation isolation.
 * The API, web builds and database run inside the disposable application fixture.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const playwright = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
const { expect, test } = playwright;
const uiRequire = createRequire(resolve(repoRoot, "packages/ui/package.json"));
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

test.use({ trace: "off", video: "off", screenshot: "off" });

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type PortalPerson = {
  email: string;
  password: string;
  personId: string;
  organisationId: string;
};

type FixtureProcess = Pick<
  MfaCsrfAppFixtureSetup,
  "databaseUrl" | "fixtureDir" | "spawnChild"
>;

function apiResponse(
  page: Page,
  method: string,
  pathname: string,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === pathname && response.request().method() === method;
  });
}

async function runPrivateCommand(
  fixture: FixtureProcess,
  args: string[],
  logPrefix: string,
) {
  const child = await fixture.spawnChild(
    process.execPath,
    [resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs"), ...args],
    {
      ...process.env,
      TASKDESK_DATABASE_URL: fixture.databaseUrl,
      TASKDESK_MIGRATION_DATABASE_URL: undefined,
    },
    logPrefix,
    fixture.fixtureDir,
  );
  await new Promise<void>((resolveClose, rejectClose) => {
    child.once("close", (code) => {
      if (code === 0) resolveClose();
      else
        rejectClose(
          new Error(
            `The private ${logPrefix} setup failed (exit ${String(code)}).`,
          ),
        );
    });
  });
}

async function seedScript(
  fixture: FixtureProcess,
  script: string,
  input: Record<string, unknown>,
  name: string,
) {
  const inputPath = resolve(fixture.fixtureDir, `${name}-input.json`);
  const outputPath = resolve(fixture.fixtureDir, `${name}-output.json`);
  writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  await runPrivateCommand(
    fixture,
    [
      "--tsconfig",
      resolve(repoRoot, "apps/api/tsconfig.tests.json"),
      resolve(repoRoot, script),
      inputPath,
      outputPath,
    ],
    name,
  );
  return JSON.parse(readFileSync(outputPath, "utf8")) as unknown;
}

async function postWithCsrf(
  context: APIRequestContext,
  origin: string,
  path: string,
  data: Record<string, unknown>,
) {
  const tokenResponse = await context.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(tokenResponse.status()).toBe(200);
  const { token } = (await tokenResponse.json()) as { token?: string };
  expect(token).toBeTruthy();
  return context.post(new URL(path, origin).toString(), {
    data,
    headers: { Origin: origin, "x-taskdesk-csrf": token ?? "" },
  });
}

async function signUpStaff(page: Page, fixture: MfaCsrfAppFixture) {
  await page.goto(new URL("/auth/sign-up", fixture.origin).toString());
  await page.getByLabel("Full name").fill("Portal projects administrator");
  await fillSensitive(page.getByLabel("Email"), fixture.email);
  await fillSensitive(page.locator('input[name="password"]'), fixture.password);
  const responsePromise = apiResponse(page, "POST", "/api/auth/sign-up/email");
  await page.getByRole("button", { name: /^create account$/i }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page).toHaveURL(
    /\/dashboard\/settings\/account\/security\?enrollmentRequired=true$/,
    { timeout: 30_000 },
  );
  const protectedRequest = () =>
    privateRequest(() =>
      page
        .context()
        .request.get(
          new URL("/api/instance/users", fixture.origin).toString(),
          {
            headers: { Origin: fixture.origin },
          },
        ),
    );
  const denied = await protectedRequest();
  expect(denied.status()).toBe(403);
  expect((await denied.text()).trim()).toBe("mfa_enrollment_required");

  await fillSensitive(page.locator("#factor-password"), fixture.password);
  const enable = apiResponse(page, "POST", "/api/auth/two-factor/enable");
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const enabled = await enable;
  expect(enabled.status()).toBe(200);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  await fillSensitive(page.locator("#enrollment-code"), totpForUri(totpURI));
  const verification = apiResponse(
    page,
    "POST",
    "/api/auth/two-factor/verify-totp",
  );
  await page.getByRole("button", { name: "Verify and enable" }).click();
  expect((await verification).status()).toBe(200);
  expect((await protectedRequest()).status()).toBe(200);
  await page.getByRole("button", { name: "I saved these codes" }).click();
}

async function createStaffWorkspace(page: Page, origin: string) {
  const api = page.context().request;
  const workspaceResponse = await postWithCsrf(api, origin, "/api/workspace", {
    name: `Portal projects ${randomUUID().slice(0, 8)}`,
  });
  expect(workspaceResponse.status()).toBe(200);
  const workspace = (await workspaceResponse.json()) as { id?: string };
  const workspaceId = workspace.id ?? "";
  expect(workspaceId).toBeTruthy();
  const projectResponse = await postWithCsrf(api, origin, "/api/project", {
    name: "Portal projects customer project",
    workspaceId,
    icon: "Folder",
    slug: uniqueProjectKey(),
  });
  expect(projectResponse.status()).toBe(200);
  const project = (await projectResponse.json()) as { id?: string };
  expect(project.id).toBeTruthy();
  const typesResponse = await api.get(
    new URL(
      `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-types`,
      origin,
    ).toString(),
    { headers: { Origin: origin } },
  );
  expect(typesResponse.status()).toBe(200);
  const types = (await typesResponse.json()) as Array<{ id: string }>;
  return {
    workspaceId,
    projectId: project.id ?? "",
    workItemTypeId: types[0]?.id ?? "",
  };
}

async function signInThroughPortal(
  page: Page,
  portalOrigin: string,
  person: PortalPerson,
) {
  await page.goto(new URL("/sign-in", portalOrigin).toString());
  await page.getByLabel("Email").fill(person.email);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  const responsePromise = apiResponse(page, "POST", "/api/auth/sign-in/email");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  expect((await responsePromise).status()).toBe(200);
  // A refused portal identity also answers 200 but revokes the session and clears its cookie;
  // fail here, not at a later redirect to /sign-in. Only booleans reach the assertion output.
  const sessionResponse = await page
    .context()
    .request.get(new URL("/api/auth/get-session", portalOrigin).toString());
  expect(sessionResponse.status()).toBe(200);
  const session = (await sessionResponse.json()) as {
    session?: unknown;
  } | null;
  expect(Boolean(session?.session)).toBe(true);
}

async function expectNoSeriousAxeViolations(page: Page) {
  await page.addScriptTag({ content: axeCoreSource });
  const violations = await page.evaluate(async () => {
    type BrowserAxe = {
      run: (context: Document) => Promise<{
        violations: Array<{ id: string; impact: string | null }>;
      }>;
    };
    const axe = (window as typeof window & { axe: BrowserAxe }).axe;
    const result = await axe.run(document);
    return result.violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map(({ id, impact }) => ({ id, impact }));
  });
  expect(violations).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectHeaderAccessible(page: Page, mobile: boolean) {
  const header = page.locator("header").first();
  await expect(header).toHaveCSS("position", "sticky");
  const controls = [
    header.getByRole("button", { name: "Toggle sidebar" }),
    header.getByRole("button", { name: "Project", exact: true }),
    mobile
      ? header.getByRole("button", { name: "Search", exact: true })
      : header.getByRole("searchbox", { name: "Search", exact: true }),
    header.getByRole("link", { name: "Get help" }),
    header.getByRole("switch", { name: "Toggle theme" }),
    header.getByRole("button", { name: "Open notifications" }),
    header.getByRole("button", { name: /^Account menu for / }),
  ];
  for (const control of controls) {
    await expect(control).toBeVisible();
    const fits = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const bounds = element.closest("header")?.getBoundingClientRect();
      return Boolean(
        bounds &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom,
      );
    });
    expect(fits).toBe(true);
  }
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toHaveAttribute("href", /^#/);
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  const [first, ...remaining] = controls;
  if (!first) throw new Error("Missing header controls.");
  await first.focus();
  for (const control of remaining) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }
  for (const control of controls.slice(-2)) {
    await control.focus();
    await page.keyboard.press("Enter");
    await expect(control).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('[data-slot="menu-positioner"]')).toHaveCount(0);
  }
}

async function runJourney(
  fixture: MfaCsrfAppFixture,
  evidencePath: (name: string) => string,
) {
  const portalOrigin = new URL(fixture.origin);
  portalOrigin.hostname = `portal.${portalOrigin.hostname}`;
  const portal = portalOrigin.toString();
  const browser = await playwright.chromium.launch({ headless: true });
  const staff = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const customer = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  try {
    const staffPage = await staff.newPage();
    await signUpStaff(staffPage, fixture);
    const support = await createStaffWorkspace(staffPage, fixture.origin);
    const tenant = (await seedScript(
      fixture,
      "tests/e2e/scripts/seed-intake-primary.ts",
      { phase: "workspace", ...support },
      "backlog-tenant",
    )) as { customer: PortalPerson; outsider: PortalPerson };
    const projects = [
      { id: support.projectId, name: "Portal projects customer project" },
    ];
    for (const name of [
      "Second customer project",
      "Outside customer project",
    ]) {
      const response = await postWithCsrf(
        staff.request,
        fixture.origin,
        "/api/project",
        {
          name,
          workspaceId: support.workspaceId,
          icon: "Folder",
          slug: uniqueProjectKey(),
        },
      );
      expect(response.status()).toBe(200);
      const project = (await response.json()) as { id: string };
      projects.push({ id: project.id, name });
    }
    const items: string[] = [];
    for (const [index, project] of projects.entries()) {
      const response = await postWithCsrf(
        staff.request,
        fixture.origin,
        `/api/projects/${project.id}/work-items`,
        {
          typeId: support.workItemTypeId,
          title: [
            "Alpha backlog request",
            "Beta backlog request",
            "Foreign backlog request",
          ][index],
        },
      );
      expect(response.status()).toBe(200);
      items.push(((await response.json()) as { id: string }).id);
    }
    const seeded = (await seedScript(
      fixture,
      "tests/e2e/scripts/seed-portal-backlog-filter.ts",
      {
        workspaceId: support.workspaceId,
        typeId: support.workItemTypeId,
        projects,
        items,
        customer: tenant.customer,
        outsider: tenant.outsider,
      },
      "backlog-items",
    )) as { keys: string[] };
    const page = await customer.newPage();
    await signInThroughPortal(page, portal, tenant.customer);
    await page.goto(new URL("/requests", portal).toString());
    const alpha = page.getByText("Alpha backlog request");
    const beta = page.getByText("Beta backlog request");
    const foreign = page.getByText("Foreign backlog request");
    const selector = page.getByRole("button", { name: "Project", exact: true });
    async function choose(name: string) {
      await selector.click();
      await page.getByRole("menuitemradio", { name, exact: true }).click();
      await expect(page.locator('[role="menu"]')).toHaveCount(0);
    }
    async function checkBacklog(
      project: string | undefined,
      action: () => Promise<unknown>,
    ) {
      const responsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/portal/requests/backlog" &&
          response.request().method() === "GET",
      );
      await action();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(new URL(response.url()).searchParams.get("project")).toBe(
        project ?? null,
      );
      await expect(page).toHaveURL(/[?&]view=backlog(?:&|$)/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Backlog" }),
      ).toBeVisible();
      const body = (await response.json()) as {
        items: Array<{ title: string }>;
      };
      expect(body.items.map((item) => item.title)).not.toContain(
        "Foreign backlog request",
      );
    }
    async function openBacklog(project: string | undefined) {
      await checkBacklog(project, () =>
        page.getByRole("button", { name: "Backlog", exact: true }).click(),
      );
    }
    const firstKey = seeded.keys[0];
    const secondKey = seeded.keys[1];
    const foreignKey = seeded.keys[2];
    if (!firstKey || !secondKey || !foreignKey)
      throw new Error("Fixture project keys missing.");
    await choose("Portal projects customer project");
    await openBacklog(firstKey);
    await expect(page).toHaveURL(new RegExp(`project=${firstKey}`));
    await expect(alpha).toBeVisible();
    await expect(beta).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const firstProjectGeometry = await page.evaluate(() => {
      const header = document.querySelector("header");
      const project = header?.querySelector('button[aria-label="Project"]');
      const elements: Record<string, Element | null | undefined> = {
        html: document.documentElement,
        body: document.body,
        sidebarProvider: document.querySelector(
          '[data-slot="sidebar-wrapper"]',
        ),
        sidebarInset: document.querySelector('[data-slot="sidebar-inset"]'),
        header,
        portalTopbar: project?.parentElement,
        projectSelector: project,
        mainTable: document.querySelector("main table"),
      };
      return Object.fromEntries(
        Object.entries(elements).map(([name, element]) => {
          if (!(element instanceof HTMLElement)) return [name, null];
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return [
            name,
            {
              x: rect.x,
              width: rect.width,
              right: rect.right,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              minWidth: style.minWidth,
              overflow: style.overflow,
              overflowX: style.overflowX,
            },
          ];
        }),
      );
    });
    writeFileSync(
      evidencePath("portal-backlog-project-a-mobile-geometry.json"),
      JSON.stringify(firstProjectGeometry, null, 2),
      { mode: 0o600 },
    );
    await page.screenshot({
      path: evidencePath("portal-backlog-project-a-mobile-viewport.png"),
      fullPage: false,
    });
    await expectNoHorizontalScroll(page);
    await expectHeaderAccessible(page, true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: evidencePath("portal-backlog-project-a-desktop.png"),
      fullPage: true,
    });
    await checkBacklog(firstKey, () => page.reload());
    await expect(alpha).toBeVisible();
    await expect(beta).toHaveCount(0);
    await page.getByRole("button", { name: /support requests/i }).click();
    await choose("Second customer project");
    await openBacklog(secondKey);
    await expect(beta).toBeVisible();
    await expect(alpha).toHaveCount(0);
    await expect(foreign).toHaveCount(0);
    await page.screenshot({
      path: evidencePath("portal-backlog-project-b-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const overflowElements = await page.evaluate(() =>
      Array.from(document.querySelectorAll("*"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            classes:
              typeof element.className === "string" ? element.className : "",
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              right: rect.right,
            },
          };
        })
        .filter((element) => element.rect.right > window.innerWidth + 1)
        .slice(0, 100),
    );
    writeFileSync(
      evidencePath("portal-backlog-project-b-mobile-overflow.json"),
      JSON.stringify(overflowElements, null, 2),
      { mode: 0o600 },
    );
    await selector.click();
    const projectMenu = page.getByRole("menu");
    await expect(projectMenu).toBeVisible();
    for (const name of [
      "All projects",
      "Portal projects customer project",
      "Second customer project",
    ]) {
      await expect(
        projectMenu.getByRole("menuitemradio", { name, exact: true }),
      ).toBeVisible();
    }
    const menuFits = await projectMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth
      );
    });
    expect(menuFits).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    const themeSwitch = page.getByRole("switch", { name: "Toggle theme" });
    for (const theme of ["light", "dark"] as const) {
      if ((await themeSwitch.isChecked()) !== (theme === "light")) {
        await themeSwitch.click();
      }
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`(?:^|\\s)${theme}(?:\\s|$)`),
      );
      await expectHeaderAccessible(page, true);
      await page.screenshot({
        path: evidencePath(`portal-backlog-project-b-mobile-${theme}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectNoHorizontalScroll(page);
    await expectHeaderAccessible(page, false);
    await themeSwitch.click();
    await expect(page.locator("html")).toHaveClass(/(?:^|\s)light(?:\s|$)/);
    await expectHeaderAccessible(page, false);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: /support requests/i }).click();
    await choose("All projects");
    await openBacklog(undefined);
    await expect(alpha).toBeVisible();
    await expect(beta).toBeVisible();
    await expect(foreign).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]project=/);
    const foreignResponse = await customer.request.get(
      new URL(
        `/api/portal/requests/backlog?project=${encodeURIComponent(foreignKey)}`,
        portal,
      ).toString(),
    );
    expect(foreignResponse.status()).toBe(200);
    expect(
      ((await foreignResponse.json()) as { items: unknown[] }).items,
    ).toEqual([]);
    await expectNoSeriousAxeViolations(page);
    await page.screenshot({
      path: evidencePath("portal-backlog-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await expectNoSeriousAxeViolations(page);
    await page.screenshot({
      path: evidencePath("portal-backlog-mobile.png"),
      fullPage: true,
    });
  } finally {
    await Promise.allSettled([
      staff.close(),
      customer.close(),
      browser.close(),
    ]);
  }
}

test("customer backlog follows the selected project", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  await withMfaCsrfApp(
    async (fixture) => runJourney(fixture, (name) => testInfo.outputPath(name)),
    {
      discardChildOutput: true,
      beforeStart: async (setup) => {
        await runPrivateCommand(
          setup,
          [
            resolve(
              repoRoot,
              "tests/e2e/scripts/seed-approval-auth-provider.ts",
            ),
          ],
          "backlog-auth",
        );
        await seedScript(
          setup,
          "tests/e2e/scripts/seed-intake-primary.ts",
          { phase: "instance" },
          "backlog-intake",
        );
        await seedScript(
          setup,
          "tests/e2e/scripts/seed-portal-projects.ts",
          { phase: "instance" },
          "backlog-portal",
        );
      },
    },
  );
});
