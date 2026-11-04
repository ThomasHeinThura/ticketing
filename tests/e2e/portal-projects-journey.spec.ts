import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page, Response } from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import {
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "./helpers/project-key";

/**
 * S4c customer portal projects, end to end on the real API, database and both web builds:
 * the customer lists their organisation's projects, opens Project Details (information,
 * contacts, subscription period, service hours, milestones, prerequisites, documents), never
 * sees an internal note or a hidden document, and gets "not found" for another organisation's
 * project key (CP-2). Axe runs on both screens (G4), desktop and mobile. U-11: Project Details
 * shows the dashboard's figures and outstanding cases for that project only.
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
            `The private ${logPrefix} setup failed (exit ${String(code)}); logs remain in the private fixture directory.`,
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
  await page.getByLabel("Email").fill(fixture.email);
  await page.locator('input[name="password"]').fill(fixture.password);
  const responsePromise = apiResponse(page, "POST", "/api/auth/sign-up/email");
  await page.getByRole("button", { name: /^create account$/i }).click();
  expect((await responsePromise).status()).toBe(200);
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

async function runJourney(
  fixture: MfaCsrfAppFixture,
  evidencePath: (name: string) => string,
) {
  const portalOrigin = new URL(fixture.origin);
  portalOrigin.hostname = `portal.${portalOrigin.hostname}`;
  const portal = portalOrigin.toString();
  const browser = await playwright.chromium.launch({ headless: true });
  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const customerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  try {
    const staffPage = await staffContext.newPage();
    await signUpStaff(staffPage, fixture);
    const support = await createStaffWorkspace(staffPage, fixture.origin);
    const tenant = (await seedScript(
      fixture,
      "tests/e2e/scripts/seed-intake-primary.ts",
      { phase: "workspace", ...support },
      "portal-projects-tenant",
    )) as { customer: PortalPerson; outsider: PortalPerson };
    const projects = (await seedScript(
      fixture,
      "tests/e2e/scripts/seed-portal-projects.ts",
      {
        phase: "engagement",
        workspaceId: support.workspaceId,
        projectId: support.projectId,
        outsiderOrganisationId: tenant.outsider.organisationId,
      },
      "portal-projects-engagement",
    )) as { projectKey: string; outsiderKey: string };

    const page = await customerContext.newPage();
    await signInThroughPortal(page, portal, tenant.customer);

    // Projects list: the sidebar entry, the WSO2-style table and its counts.
    const listResponse = apiResponse(page, "GET", "/api/portal/projects");
    await page.goto(new URL("/projects", portal).toString());
    expect((await listResponse).status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Projects", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const row = page.getByRole("row", { name: /Portal rollout/u });
    await expect(row).toContainText(projects.projectKey);
    await expect(row).toContainText("Active");
    await page.screenshot({
      path: evidencePath("portal-projects-desktop-light.png"),
      fullPage: true,
    });
    await expect(
      page.getByRole("link", { name: "Outsider operations" }),
    ).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);

    // Search and tabs are URL state.
    await page
      .getByRole("searchbox", { name: "Search projects" })
      .fill("no such project");
    await expect(page).toHaveURL(/q=no\+such\+project|q=no%20such%20project/u);
    await expect(page.getByText("No matching projects")).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await page.getByRole("tab", { name: "Managed services" }).click();
    await expect(page).toHaveURL(/tab=services/u);
    await expect(page.getByText("No matching projects")).toBeVisible();
    await page.getByRole("tab", { name: "All" }).click();

    // Project Details.
    const detailResponse = apiResponse(
      page,
      "GET",
      `/api/portal/projects/${projects.projectKey}`,
    );
    // U-11: the figures and the cases are read for this project only.
    const scopedHome = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/portal/home" &&
        url.searchParams.get("project") === projects.projectKey
      );
    });
    const scopedCases = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/portal/requests" &&
        url.searchParams.get("project") === projects.projectKey
      );
    });
    await page.getByRole("link", { name: "Portal rollout" }).click();
    const detail = await detailResponse;
    expect(detail.status()).toBe(200);
    const detailText = await detail.text();
    expect(detailText).not.toContain("INTERNAL NOTE");
    expect(detailText).not.toContain("margin");
    await expect(
      page.getByRole("heading", { level: 1, name: "Portal rollout" }),
    ).toBeVisible();
    for (const title of [
      "Project information",
      "Contact information",
      "Subscription period",
      "Service hours allocation",
      "About this project",
      "Milestones",
      "What we need from you",
      "Documents",
    ])
      await expect(
        page.getByRole("heading", { level: 2, name: title }),
      ).toBeVisible();
    const home = await scopedHome;
    expect(home.status()).toBe(200);
    const figures = (await home.json()) as { outstanding: number };
    expect((await scopedCases).status()).toBe(200);
    const projectFigures = page.getByRole("region", {
      name: "Project figures",
      exact: true,
    });
    await expect(projectFigures.getByText("Outstanding")).toBeVisible();
    await expect(
      projectFigures.getByRole("link", { name: /^Outstanding/u }),
    ).toContainText(String(figures.outstanding));
    await expect(
      page.getByRole("link", { name: /^View all /u }),
    ).toHaveAttribute(
      "href",
      new RegExp(`[?&]project=${projects.projectKey}(&|$)`, "u"),
    );
    await expect(page.getByText("29 days remaining")).toBeVisible();
    await expect(page.getByText("0 of 100 hours used")).toBeVisible();
    await expect(
      page.getByText("Provide VPN access for the support team"),
    ).toBeVisible();
    const document = page.getByRole("link", { name: /Statement of work/u });
    await expect(document).toHaveAttribute("rel", "noopener noreferrer");
    await expect(document).toHaveAttribute("target", "_blank");
    // U-15: the entry shows its description; only customer-visible entries are listed.
    await expect(page.getByText("Signed scope and fees")).toBeVisible();
    await expect(page.getByTestId("portal-project-document")).toHaveCount(1);
    await expect(page.getByText("Internal margin sheet")).toHaveCount(0);
    await expect(page.getByText("INTERNAL NOTE")).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
    await page.screenshot({
      path: evidencePath("portal-project-detail-desktop-light.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoSeriousAxeViolations(page);
    await page.screenshot({
      path: evidencePath("portal-project-detail-desktop-dark.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });

    // Keyboard: Back to the list from the page's own link.
    await page.getByRole("link", { name: "All projects" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects$/u);

    // Mobile: no horizontal page scroll on either screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await page.goto(
      new URL(`/projects/${projects.projectKey}`, portal).toString(),
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Portal rollout" }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: evidencePath("portal-project-detail-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 820, height: 1180 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: evidencePath("portal-project-detail-tablet.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });

    // CP-2: another organisation's key is "not found", from the API and on screen.
    const foreignResponse = apiResponse(
      page,
      "GET",
      `/api/portal/projects/${projects.outsiderKey}`,
    );
    await page.goto(
      new URL(`/projects/${projects.outsiderKey}`, portal).toString(),
    );
    expect((await foreignResponse).status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Project not found" }),
    ).toBeVisible();
    await expect(page.getByText("Outsider operations")).toHaveCount(0);
  } finally {
    await Promise.allSettled([
      staffContext.close(),
      customerContext.close(),
      browser.close(),
    ]);
  }
}

test("customer lists projects, reads Project Details and cannot open another organisation's project", async ({
  browserName: _browserName,
}, testInfo) => {
  // Fixture boot (~15 s) plus two signed-in browser phases; 120 s matches the intake journey.
  test.setTimeout(180_000);
  await withMfaCsrfApp(
    async (fixture) => runJourney(fixture, (name) => testInfo.outputPath(name)),
    {
      beforeStart: async (setup) => {
        await runPrivateCommand(
          setup,
          [
            resolve(
              repoRoot,
              "tests/e2e/scripts/seed-approval-auth-provider.ts",
            ),
          ],
          "portal-projects-customer-auth-provider",
        );
        await seedScript(
          setup,
          "tests/e2e/scripts/seed-intake-primary.ts",
          { phase: "instance" },
          "portal-projects-instance",
        );
        await seedScript(
          setup,
          "tests/e2e/scripts/seed-portal-projects.ts",
          { phase: "instance" },
          "portal-projects-portal-flag",
        );
      },
    },
  );
});
